'use strict';

const fs = require('fs').promises;

async function read_json(fname, initial) {
  try {
    var result = await fs.readFile(fname);
    return JSON.parse(result);
  } catch (error) {
    return initial;
  }
}

async function write_json(fname, json) {
  await fs.writeFile(fname, JSON.stringify(json, null, '\t'));
}

async function list_json(folder){
  let list;
  try{
    list = await fs.readdir(folder);
  }catch(error){
    return null;
  }
  const json_list = [];
  for( const item of list ){
    const stat = await fs.stat(folder + (folder.endsWith('/') ? "" : '/' ) + item);
    if( stat.isDirectory() )
      continue;
    json_list.push(item);
  }
  return json_list;
}

module.exports = {
  read_json,
  write_json,
  list_json,
};