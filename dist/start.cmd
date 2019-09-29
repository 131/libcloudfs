set DEBUG=random-read-http:info,osqlite:swift:info,casfs:info,random-read-http:error,osqlite:swift:error,casfs:error
node node_modules/cnyks/bin/cnyks ./bin --ir://run=simple_ro --config_path=config/config.json
