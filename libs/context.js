"use strict";

const SQLITE = require('./sql');


const get  = require('mout/object/get');
const SQL  = SQLITE.SQL;



class Ctx {

  constructor(config) {
    this.SQL    = SQL;
    this._config = config;
  }

  fork() {
    var ctx = new Ctx(this._config);
    ctx.storage = this.storage;
    ctx.mountpoint = this.mountpoint;
    ctx._lnk = this._lnk;
    return ctx;
  }

  config(path) {
    return get(this._config, path);
  }

  close() {
    this._lnk = null;
  }

  get lnk() {
    if(this._lnk)
      return this._lnk;
    this._lnk = new SQLITE('data/test.sqlite'); //, {memory:true}

    return this._lnk;
  }

}

module.exports = Ctx;
