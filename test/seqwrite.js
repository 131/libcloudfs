"use strict";

const sprintf = require('util').format;
const expect = require('expect.js');

const bl     = require('bl');

const guid    = require('mout/random/guid');
const Storage = require('swift/storage');
const Context = require('swift/context');

var creds;
if(process.env['OS_USERNAME']) {
  creds = {
    "username" : process.env['OS_USERNAME'],
    "password" : process.env['OS_PASSWORD'],
    "tenantId" : process.env['OS_TENANT_ID'],
    "region"   : process.env['OS_REGION_NAME'],
  };
} else {
  creds = require('./credentials.json');
}
const storage_container = "trashme_tests_ci";


process.env["BIGFILE_SPLIT"] = 60; //force tiny files

//require that AFTER configuration/env has been setup
const SeqWriteHTTP = require('../lib/seqwritehttp');
//const CCD          = require('../lib/ccd');



const block_path = function(hash) {
  return sprintf("%s/%s/%s", hash.substr(0, 2), hash.substr(2, 1), hash);
};

var storage_ctx, lnk;

describe("SeqwriteHTTP test", function() {
  this.timeout(10 * 1000);

  it("should create a dedicated container", async () => {
    storage_ctx = await Context.build(creds);
    var res = await Storage.createContainer(storage_ctx, storage_container);
    expect(res).to.be.ok();
  });

  it("should write a bigfile", async () => {

    writer = new SeqWriteHTTP({storage_ctx, storage_container, block_path});
  
    let payload = [guid(), guid(), guid(), guid()].join("\n"); //more than 60
    let body = bl(payload);

    let size = await new Promise(resolve => writer.write(body, body.length, 0, resolve));

    expect(size).to.eql(body.length);

    let {block_hash, block_size} = await writer.close();
    expect(block_size).to.eql(body.length);
    expect(block_hash).to.eql(body_md5);

    console.log("Done writing, now checking");
    let final_path = block_path(block_hash);
    let remote = await Storage.download(storage_ctx, storage_container, final_path);
    remote = String(await drain(remote));
    expect(remote).to.eql(body);
  });
});

/*
describe("CAS Consolidation daemon suite", function(){
  let ccd;

  it("should create CCD instance", function() {
    ccd = new CCD({storage_ctx, storage_container, block_path});
  });

  it("should do a proper run", async () => {
    var temp = await Storage.getFileList(storage_ctx, storage_container);
    console.log(temp);
    process.exit();
    var temp = await Storage.getFileList(storage_ctx, storage_container);
    await ccd.tick();
  });
});

*/
