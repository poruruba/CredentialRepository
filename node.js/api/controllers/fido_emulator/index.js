'use strict';

const HELPER_BASE = process.env.HELPER_BASE || '../../helpers/';
const Response = require(HELPER_BASE + 'response');
const jsonfile = require(HELPER_BASE + 'jsonfile-utils');

const API_KEY = 'dMVqQGqwuhTS';

const FIDO_ISSUER = process.env.FIDO_ISSUER || '【Node.jsサーバのURL】';
const FIDO_SUBJECT = process.env.FIDO_SUBJECT || 'fido_emurator';
const FIDO_EXPIRE = Number(process.env.FIDO_EXPIRE) || 3650;
const FIDO_EXPIRE_START = process.env.FIDO_EXPIRE_START || '210620150000Z'; // 形式：YYMMDDHHMMSSZ (UTC時間)

const DEVICE_FILE_BASE = process.env.THIS_BASE_PATH + '/data/fido2_account/';
const STATE_FILE_BASE = process.env.THIS_BASE_PATH + '/data/fido2_state/';
const PRIV_FNAME = "privkey.pem";
const STATE_FNAME = "state.json";

const rs = require('jsrsasign');
const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');

var kp_cert;
var sequence_no = 0;

(async () => {
  // X509証明書の楕円暗号公開鍵ペアの作成
  try{
    await fs.access(STATE_FILE_BASE + PRIV_FNAME);
    var pem = await fs.readFile(STATE_FILE_BASE + PRIV_FNAME);
    kp_cert = rs.KEYUTIL.getKey(pem.toString());
  }catch(error){
    var kp = rs.KEYUTIL.generateKeypair('EC', 'secp256r1');
    kp_cert = kp.prvKeyObj;
    fs.writeFile(FILE_BASE + STATE_FILE_BASE, rs.KEYUTIL.getPEM(kp_cert, "PKCS1PRV"));
  }
  
  // シーケンス番号の復旧
  var state = await jsonfile.read_json(STATE_FILE_BASE + STATE_FNAME, { sequence_no: 0 } );
  sequence_no = state.sequence_no;
})();

exports.handler = async (event, context, callback) => {
  var apikey = event.requestContext.apikeyAuth.apikey;
  if( !checkAlnum(apikey) )
    throw new Error('apikey invalid');
  var list = await jsonfile.read_json(DEVICE_FILE_BASE + apikey + ".json");
  if( !list )
    throw new Error('apikey not found');

  var body = JSON.parse(event.body);
  console.log(body);

  if( event.path == '/fido2-device-delete'){
		var index = list.findIndex(item => item.id == body.id );
		if( index < 0 )
			throw 'item not found';

		list.splice(index, 1);
    await jsonfile.write_json(DEVICE_FILE_BASE + apikey + ".json", list);

    return new Response({});
  }else
  if( event.path == '/fido2-device-update'){
    var item = list.find(item => item.id == body.id );
		if( !item )
			throw 'item not found';
    item.name = body.name;
    await jsonfile.write_json(DEVICE_FILE_BASE + apikey + ".json", list);

    return new Response({});
  }else
  if( event.path == '/fido2-device-list'){
    var device_list = [];
    for( let item of list){
      var t = {
        key_id: item.key_id,
        name: item.name,
        counter: item.counter,
        created_at: item.created_at
      };
      if( item.lastauthed_at )
        t.lastauthed_at = item.lastauthed_at;
      device_list.push(t);
    }

    return new Response({
      list: device_list,
      issuer: FIDO_ISSUER 
    });
  }else

  if (event.path == "/device/u2f_register") {
    var input = Buffer.from(body.input, 'hex');
    var challenge = input.subarray(7, 7 + 32);
    var application = input.subarray(7 + 32, 7 + 32 + 32);
    var result = await u2f_register(list, challenge, application);
    await jsonfile.write_json(DEVICE_FILE_BASE + apikey + ".json", list);

    return new Response({
      result: Buffer.concat([result, Buffer.from([0x90, 0x00])]).toString('hex')
    });
  } else
    if (event.path == "/device/u2f_authenticate") {
      var input = Buffer.from(body.input, 'hex');
      var result;
      try {
        var control = input[2];
        var challenge = input.subarray(7, 7 + 32);
        var application = input.subarray(7 + 32, 7 + 32 + 32);
        var keyHandle = input.subarray(7 + 32 + 32 + 1, 7 + 32 + 32 + 1 + input[7 + 32 + 32]);
        result = await u2f_authenticate(list, control, challenge, application, keyHandle);

        await jsonfile.write_json(DEVICE_FILE_BASE + apikey + ".json", list);
      } catch (sw) {
        return new Response({
          result: sw.toString('hex')
        });
      };

      return new Response({
        result: Buffer.concat([result, Buffer.from([0x90, 0x00])]).toString('hex')
      });
    } else
      if (event.path == "/device/u2f_version") {
        var result = await u2f_version();
        return new Response({
          result: Buffer.concat([result, Buffer.from([0x90, 0x00])]).toString('hex')
        });
      }
};

async function u2f_register(list, challenge, application) {
  console.log('application=', application.toString('hex'));

  // 内部管理用のKeyIDの決定
  var state = await jsonfile.read_json(STATE_FILE_BASE + STATE_FNAME, { sequence_no: 0 } );
  state.sequence_no++;

  var uuid = crypto.randomBytes(16);
  uuid[0] = (sequence_no >> 24) & 0xff;
  uuid[1] = (sequence_no >> 16) & 0xff;
  uuid[2] = (sequence_no >> 8) & 0xff;
  uuid[3] = (sequence_no) & 0xff;
  var key_id = uuid.toString('hex');
  console.log('key_id=' + key_id);

  await jsonfile.write_json(STATE_FILE_BASE + STATE_FNAME, state);

  // 楕円暗号公開鍵ペアの作成
  var kp = rs.KEYUTIL.generateKeypair('EC', 'secp256r1');
  console.log(kp.pubKeyObj.pubKeyHex);
  var userPublicKey = Buffer.from(kp.pubKeyObj.pubKeyHex, 'hex');

  var credential = {
    key_id: key_id,
    application: application.toString('hex'),
    privkey: rs.KEYUTIL.getPEM(kp.prvKeyObj, "PKCS1PRV"),
    counter: 1,
    created_at: new Date().getTime()
  };

  // KeyHandleの作成
  var keyHandle = Buffer.concat([uuid]);
  var keyLength = Buffer.from([keyHandle.length]);

  //サブジェクトキー識別子
  const ski = rs.KJUR.crypto.Util.hashHex(kp.pubKeyObj.pubKeyHex, 'sha1');
//  const derSKI = new rs.KJUR.asn1.DEROctetString({ hex: ski });

  // X.509証明書の作成
  var cert = new rs.KJUR.asn1.x509.Certificate({
    version: 3,
    serial: { int: sequence_no },
    issuer: { str: "/CN=" + FIDO_ISSUER },
    notbefore: FIDO_EXPIRE_START,
    notafter: toUTCString(new Date(Date.now() + FIDO_EXPIRE * 24 * 60 * 60 * 1000)),
    subject: { str: "/CN=" + FIDO_SUBJECT + ("0000000000" + sequence_no).slice(-10) },
    sbjpubkey: kp.pubKeyObj, // can specify public key object or PEM string
    sigalg: "SHA256withECDSA",
    ext: [
      {
        //サブジェクトキー識別子
        extname: "subjectKeyIdentifier",
        kid: {
//          hex: derSKI.getEncodedHex()
          hex: ski
        }
      },
      {
        // FIDO U2F certificate transports extension
        extname: "1.3.6.1.4.1.45724.2.1.1",
        extn: "03020640"
      }
    ],
    cakey: kp_cert
  });
  console.log(cert.getPEM());

  var attestationCert = Buffer.from(cert.getEncodedHex(), 'hex');

  // 署名の生成
  var input = Buffer.concat([
    Buffer.from([0x00]),
    application,
    challenge,
    keyHandle,
    userPublicKey
  ]);
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(input);
  var signature = sign.sign(rs.KEYUTIL.getPEM(kp.prvKeyObj, "PKCS1PRV"));

  console.log('userPublicKey(' + userPublicKey.length + ')=' + userPublicKey.toString('hex'));
  console.log('keyHandle(' + keyHandle.length + ')=' + keyHandle.toString('hex'));
  console.log('attestationCert(' + attestationCert.length + ')=' + attestationCert.toString('hex'));
  console.log('signature(' + signature.length + ')=' + signature.toString('hex'));

  list.push(credential);

  // レスポンスの生成(concat)
  var response = Buffer.concat([
    Buffer.from([0x05]),
    userPublicKey,
    keyLength,
    keyHandle,
    attestationCert,
    signature
  ]);
  return response;
}

async function u2f_authenticate(list, control, challenge, application, keyHandle) {
  console.log('control=', control);
  console.log('application=', application.toString('hex'));

  var userPresence = Buffer.from([0x01]);

  // 内部管理用のKeyIDの抽出
  var key_id = keyHandle.slice(0, 16).toString('hex');
  console.log('key_id=' + key_id);
  if (!checkAlnum(key_id)) {
    console.log('key_id invalid')
    throw Buffer.from([0x6a, 0x80]);
  }

//  var cert = await readCertFile(key_id);
  var cert = list.find( item => item.key_id == key_id);
//  var cert = await jsonfile.read_json(DEVICE_FILE_BASE + key_id + '.json');
  if (!cert) {
    console.log('key_id not found');
    throw Buffer.from([0x6a, 0x80]);
  }

  if (cert.application.toLowerCase() != application.toString('hex').toLowerCase()) {
    console.log('application mismatch');
    throw Buffer.from([0x6a, 0x80]);
  }

  if (control == 0x07) {
    throw Buffer.from([0x69, 0x85]);
  }

  // 署名回数カウンタのインクリメント
  cert.counter++;
  cert.lastauthed_at = new Date().getTime();
//  await jsonfile.write_json(DEVICE_FILE_BASE + key_id + '.json', cert);
//  await writeCertFile(key_id, cert);
  console.log('counter=' + cert.counter);
  var counter = Buffer.from([(cert.counter >> 24) & 0xff, (cert.counter >> 16) & 0xff, (cert.counter >> 8) & 0xff, cert.counter & 0xff])

  // 署名生成
  var input = Buffer.concat([
    application,
    userPresence,
    counter,
    challenge
  ]);
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(input);
  var signature = sign.sign(cert.privkey);

  console.log('input(' + input.length + ')=' + input.toString('hex'));
  console.log('sigunature(' + signature.length + ')=' + signature.toString('hex'));

  // verify sample code
  /*
    const verify = crypto.createVerify('RSA-SHA256')
    verify.write(input)
    verify.end();
  
    var result =  verify.verify(
      privateKey.asPublic().toPEM(),
      signature
    );
    console.log('verify result=' + result);
  */

  // レスポンスの生成(concat)
  return Buffer.concat([
    userPresence,
    counter,
    signature
  ]);
}

async function u2f_version() {
  var version = Buffer.from('U2F_V2');
  return Promise.resolve(version);
}

function toUTCString(date) {
  var year = date.getUTCFullYear();
  var month = date.getUTCMonth() + 1;
  var day = date.getUTCDate();
  var hour = date.getUTCHours();
  var minutes = date.getUTCMinutes();
  var seconds = date.getUTCSeconds();

  return to2d(year % 100) + to2d(month) + to2d(day) + to2d(hour) + to2d(minutes) + to2d(seconds) + "Z";
}

function to2d(num) {
  if (num < 10)
    return '0' + String(num);
  else
    return String(num);
}

function checkAlnum(str) {
  var ret = str.match(/([a-zA-Z0-9])/gi);
  return (ret.length == str.length)
}
