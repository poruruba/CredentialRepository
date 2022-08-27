'use strict';

const HELPER_BASE = process.env.HELPER_BASE || "/opt/";
const Response = require(HELPER_BASE + 'response');
const Redirect = require(HELPER_BASE + 'redirect');

const BASE_PATH = process.env.THIS_BASE_PATH;
const jsonfile = require(HELPER_BASE + 'jsonfile-utils');

const { totp, hotp } = require('otplib');
const { URL, URLSearchParams } = require('url');
const crypto = require('crypto');

const ACCOUNTS_FOLDER = BASE_PATH + "/data/otp_account/";

exports.handler = async (event, context, callback) => {
	var body = JSON.parse(event.body);
	console.log(body);

	var apikey = event.requestContext.apikeyAuth.apikey;
	if( !checkAlnum(apikey) )
		throw new Error('apikey invalid');
	var list = await jsonfile.read_json(ACCOUNTS_FOLDER + apikey + ".json");
	if( !list )
		throw new Error('apikey not found');

	if( event.path == '/otp-register'){
		var otp = otp_parse(body.url);
		var item = list.find(item => (item.account_name == otp.account_name && item.issuer == otp.issuer));
		if( item )
			throw new Error("already exists");

		list.push({
			uuid: crypto.randomUUID(),
			uri: body.url,
			account_name: otp.account_name,
			issuer: otp.issuer,
			secret: otp.secret,
			method: otp.method,
			created_at: new Date().getTime()
		});
		await jsonfile.write_json(ACCOUNTS_FOLDER + account + ".json", list);

		return new Response({});
	}else
	if( event.path == '/otp-delete' ){
		var uuid = body.uuid;
		var index = list.findIndex(item => item.uuid == uuid);
		if( index < 0)
			throw new Error('not found');
		list.splice(index, 1);
		await jsonfile.write_json(ACCOUNTS_FOLDER + account + ".json", list);
		return new Response({});
	}else
	if( event.path == '/otp-generate' ){
		var uuid = body.uuid;
		var item = list.find(item => (item.uuid == uuid));
		if( !item )
			throw new Error("not found");

		var code;
		if( item.method == 'totp')
			code = totp.generate(item.secret);
		else if( item.method == 'hotp' )
			code = hotp.generate(item.secret);
		else
			throw new Error('unknown method');

		return new Response({code: code});
	}else
	if( event.path == '/otp-list' ){
		var result_list = JSON.parse(JSON.stringify(list));
		for( let item of result_list )
			delete item.secret;
		
		return new Response({ list: result_list });
	}else
	if( event.path == '/otp-get' ){
		var uuid = body.uuid;
		var item = list.find(item => (item.uuid == uuid));
		if( !item )
			throw new Error("not found");

		return new Response({ uri: item.uri });
	}
};

function checkAlnum(str){
  var reg = new RegExp(/^[a-zA-Z0-9-]+$/);
	return reg.test(str);
}

function otp_parse(uri){
	var url = new URL(uri);
	if( url.protocol != "otpauth:" || (url.hostname != "totp" && url.hostname != "hotp") )
		throw new Error("protocol.hostname mismatch");
	return {
		account_name: decodeURI(url.pathname).slice(1),
		secret: url.searchParams.get("secret"),
		issuer: url.searchParams.get("issuer"),
		method: url.hostname
	};
}