Cloudfs.


Unlimited drive.

cloudfs is a **file system** that stores all its data in the cloud.
cloudfs store file contents in a CAS designed cloud object storage backend [openstack swift](https://developer.openstack.org/api-ref/object-store/) and files metadata (inode table) in an SQL database (sqlite - [see dedicated sqlfs project](https://github.com/131/sqlitefs)).


# Roadmap
- [X] Read Only POC using full openstack creds
- [X] Full Read Only POC using tempUrl keys (no full creds ever required)

- [X] Writable Inodes POC (rename, delete, mkdir)
- [ ] Writable/editable files
- [ ] Proper deployment flow
- [ ] Support for nwjs (fuse-binding & sqlite3)
- [ ] Embbed configuration/web browse server
- [ ] Publish read-only mode


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



# Background daemon & pending tasks
* Garbage collection



# Related
* [s3ql](https://github.com/s3ql/) python based, non CAS (but fixed block)



