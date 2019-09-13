"use strict";



const BIGFILE_HEADER = 'x-object-meta-bigfile';
const BIGFILE_SPLIT = (1 << 30) * 5; //5Go
//const BIGFILE_SPLIT = (1 << 20) * 5; //5Mo


const SEGMENT_MAX_AGE           = 86400 * 1000;
const SEGMENT_CLEANUP_HEARTBEAT = 3600 * 6 * 1000;
const SEGMENT_PREFIX            = '.tmp';
//CASConsolidationDaemon

const MIME_FILE  = "application/octet-stream";
const MIME_LARGE = "application/large-file";

module.exports = {
  BIGFILE_HEADER,
  BIGFILE_SPLIT : process.env.BIGFILE_SPLIT || BIGFILE_SPLIT,
  SEGMENT_MAX_AGE,
  SEGMENT_PREFIX,
  SEGMENT_CLEANUP_HEARTBEAT,

  MIME_LARGE,
  MIME_FILE,
};
