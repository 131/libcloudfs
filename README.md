Cloudfs.

Unlimited drive.


cloudfs is a **file system** that stores all its data in the cloud.

cloudfs store file contents in a cloud object storage backend (openstack swift) and files metadata (inode table) relies on an SQL database (sqlite or remote pgsql)


# Roadmap
## Full POC
* Support for nwjs (fuse-binding & sqlite3)
* On the fly tar creation
* 
## TODO
* Drop rclone layer (


# Features
* Simple by design
* Available on all platforms (linux & Windows)
* Fast (sqlite is actually fastest than most file system)
* large subset of POSIX including reading/writing files, directories, rename,  symlinks, mode, uid/gid, and extended attributes
* renames do not invole any kind of server side copy
* native file deduplication - through CAS
* Compatible with existing CAS

## Additional features
* nice configuration GUI
* Directroy tree snapshot / rollback / sealing (pure SQL)
* Instant file deletion (pure SQL)
* Server side TAR creation (so content duplication) - through static large object.
* Per design read-only access  (using openstack tempURL key)
* Battery included
  * bundled control interface
  * Instant file copy


# Background daemon & pending tasks
* Garbage collection
* Segment file consolidation

# Installation
* Windows
  * Download & install [WinFSP](http://www.secfs.net/winfsp/).
  * Download portable cloudfs installer.

* Unix


# Related
* [s3ql](https://github.com/s3ql/) python based, non CAS (but fixed block)



