'use strict';

const HELPER_BASE = process.env.HELPER_BASE || '/opt/';
const Response = require(HELPER_BASE + 'response');
const jsonfile = require(HELPER_BASE + 'jsonfile-utils');

const FILE_BASE = process.env.THIS_BASE_PATH + '/data/password_account/';

const crypto = require('crypto');

exports.handler = async (event, context, callback) => {
	var body = JSON.parse(event.body);
	var apikey = event.requestContext.apikeyAuth.apikey;
	if( !checkAlnum(apikey) )
		throw new Error('apikey invalid');

	var pwd = await readPasswordFile(apikey);
	if( !pwd )
		throw new Error('apikey not found');

	if( event.path == '/pwd-get' ){
		var item = pwd.list.find(item => item.uuid == body.uuid );
		if( !item )
			throw 'item not found';

		return new Response({ item: item });
	}else
	if( event.path == '/pwd-list' ){
		var list = [];
		pwd.list.forEach(item => list.push({ uuid: item.uuid, name: item.name, url: item.url, userid: item.userid, description: item.description } ));
		return new Response({ list: list });
	}else
	if( event.path == '/pwd-insert' ){
		if( !body.name )
			throw "invalid name";

		var uuid = crypto.randomUUID().toLowerCase();
		pwd.list.push({ uuid: uuid, name: body.name, url: body.url, userid: body.userid, password: body.password, description: body.description });

		await writePasswordFile(apikey, pwd);
		return new Response({});
	}else
	if( event.path == '/pwd-update' ){
		var item = pwd.list.find(item => item.uuid == body.uuid );
		if( !item )
			throw 'item not found';

		if( body.name !== undefined ) item.name = body.name;
		if( body.url !== undefined ) item.url = body.url;
		if( body.userid !== undefined ) item.userid = body.userid;
		if( body.password !== undefined ) item.password = body.password;
		if( body.description !== undefined ) item.description = body.description;

		await writePasswordFile(apikey, pwd);

		return new Response({});
	}else
	if( event.path == '/pwd-delete' ){
		var index = pwd.list.findIndex(item => item.uuid == body.uuid );
		if( index < 0 )
			throw 'item not found';

		pwd.list.splice(index, 1);

		await writePasswordFile(apikey, pwd);
		return new Response({});
	}
};

function checkAlnum(str){
  var reg = new RegExp(/^[a-zA-Z0-9/-]+$/);
	return reg.test(str);
}

async function readPasswordFile(apikey){
	return jsonfile.read_json(FILE_BASE + apikey + '.json');
}

async function writePasswordFile(apikey, pwd){
	return jsonfile.write_json(FILE_BASE + apikey + '.json', pwd);
}
