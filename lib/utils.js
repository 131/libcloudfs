"use strict";

const fs = require('fs');

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


module.exports = {nodeify, isDirectory, filesize, fileExists};
