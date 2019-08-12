"use strict";

const fs = require('fs');
const {O_WRONLY, O_CREAT} = fs.constants;
const fuse = require('./fuse');

const isDirectory = function(directory_path) {
  return new Promise((resolve) => {
    fs.stat(directory_path, (err, stat) => {
      resolve(stat && stat.isDirectory());
    });
  });
};

const fileExists = function(file_path) {
  return new Promise((resolve) => {
    fs.stat(file_path, (err, stat) => {
      resolve(!!stat);
    });
  });
};

const filesize = function(file_path) {
  return new Promise((resolve) => {
    fs.stat(file_path, (err, stat) => {
      resolve(stat && stat.size);
    });
  });
};


const filemtime = function(file_path) {
  return new Promise((resolve) => {
    fs.stat(file_path, (err, stat) => {
      resolve(stat && stat.mtime);
    });
  });
};


const touch = function(file_path, when = new Date()) {
  return new Promise((resolve, reject) => {
    fs.open(file_path, O_WRONLY | O_CREAT, 0o666, function(err, fd) {
      if(err)
        return reject(err);
      fs.futimes(fd, when, when, function(err) {
        if(err)
          return reject(err);
        fs.close(fd, function(err) {
          if(err)
            return reject(err);
          resolve();
        });
      });
    });
  });
};

const nodeify   = function(worker, self) {
  return function(...payload) {
    var chain = payload.pop();
    worker.apply(self, payload).then(function(body) {
      chain(0, body);
    }).catch(function(err) {
      if(!isFinite(err))
        console.error(err);
      console.log("Responging with error", err);
      chain(err);
    });
  };
};


module.exports = {nodeify, isDirectory, filesize, fileExists, touch, filemtime, fuse};
