"use strict";

const SQL       = require('sql-template');

const pluck     = require('mout/array/pluck');
const values    = require('mout/object/values');
const merge     = require('mout/object/merge');
const sqlite    = require('sqlite3');

const debug     = require('debug')('sqlite');

class SQLITE {

  constructor(...src) {
    this.transactions_stack = {};
    this._lnk = null;
    this.pfx = {};
    this._src = src;
  }

  get lnk() {
    return this;
  }

  connect() {
    if(this._lnk)
      return this._lnk;

    var lnk = new sqlite.Database(...this._src);
    lnk.get("PRAGMA foreign_keys = ON");
    this._lnk = lnk;
    return lnk;
  }

  async query(query) {
    return this._query(query, 'run');
  }

  _run(query) { return this._query(query, 'run'); }
  _all(query) { return this._query(query, 'all'); }
  _get(query) { return this._query(query, 'get'); }

  _query(query, verb) {
    var lnk = this.connect();
    debug(query.toString());
    var values = query.values.reduce((o, v, k) => (o[k + 1] = query.values[k], o), {});

    return new Promise((resolve, reject) => {
      lnk[verb](query.text, values, function(err, result) {
        if(err)
          return reject(err);
        resolve(result);
      });
    });
  }


  async select(table /*, cond, cols*/) {
    var query = typeof table != "string" ? table : SQL.select(...arguments);
    var result = await this._all(query);
    return result;
  }

  async value(table, cond, col) {
    var row = await this.row(...arguments);
    if(!row)
      return;

    var value = col && col in row ? row[col] : row[ Object.keys(row)[0] ];
    return value;
  }

  async row(table /*, cond, cols*/) {
    var query = typeof table != "string" ? table : SQL.select(...arguments);
    var result = await this._get(query);
    return result;
  }

  async col(table, cond, col) {
    var rows = await this.select(...arguments);
    return pluck(rows, col);
  }

  async insert() {
    var query = SQL.insert(...arguments);
    return await this._run(query);
  }


  async insert_bulk(/*table, keys, values*/) {
    var query = SQL.insert_bulk(...arguments);
    return await this._run(query);
  }


  async truncate(table) {
    var query = SQL`TRUNCATE TABLE $id${table}`;
    return await this._run(query);
  }


  async delete(table, where) {
    var query = SQL`DELETE FROM $id${table} $where${where}`;
    return await this._run(query);
  }


  async update(table, values, where) {
    if(where === undefined)
      where = true;

    if(Object.keys(values).length == 0)
      return;
    var query = SQL`UPDATE $id${table} $set${values} $where${where}`;
    return await this._run(query);
  }

  async replace(table, values, where) {
    let row = await this.row(table, where, "*", "FOR UPDATE");
    if(row)
      await this.update(table, values, where);
    else
      await this.insert(table, merge({}, values, where));
  }


  get_transaction_level() {
    var depths = values(this.transactions_stack);
    var level = depths.length ? Math.max.apply(null, depths) + 1 : 0;
    return level;
  }

  async begin() {
    var transaction_hash = `_trans_${Math.random().toString(16).substr(2)}`;

    var level = this.get_transaction_level();

    this.transactions_stack[transaction_hash] = level;

    var query = SQL`BEGIN`;
    if(level != 0)
      throw `Unsupported nested transactions - for now`;

    await this.query(query);
    return transaction_hash;
  }

  async commit(transaction_hash) {
    var level = this.transactions_stack[transaction_hash];

    if(level === undefined)
      throw `Incorrect transaction passed ${transaction_hash}`;

    delete this.transactions_stack[transaction_hash];
    var max_depth = this.get_transaction_level();

    if(max_depth > level)
      throw `Incorrect transaction level passed ${level} < ${max_depth}`;

    if(level == 0) {
      try {
        await this.query(SQL`COMMIT`);
      } catch(err) {
        //re-instate transaction level so it can be rolledback
        this.transactions_stack[transaction_hash] = level;
        throw err;
      }
    }

    return true;
  }



  close() {
    if(this._lnk)
      this._lnk.close();
    this._lnk = null;
  }


}



module.exports = SQLITE;
module.exports.SQL = SQL;


