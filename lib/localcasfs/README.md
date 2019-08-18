Large file/chunk are also present in cas

there're stored as follow

/path/in/cas/[full file hash].manifest

When opening a file from the CAS, the first stat will fail, then fallback trying to open the bigfile manifest.
