var Manager = require('./manager.js');
var pkg = require("../package.json");
var http = require("http");

var ProviderEngine = require("web3-provider-engine");
var FilterSubprovider = require('web3-provider-engine/subproviders/filters.js');
var VmSubprovider = require('web3-provider-engine/subproviders/vm.js');
var Subprovider = require('web3-provider-engine/subproviders/subprovider.js');

var inherits = require("util").inherits;

inherits(ReactiveBlockTracker, Subprovider);

function ReactiveBlockTracker() {
  this.methods = {
    "eth_call": "before",
    "eth_getStorageAt": "before",

    // Wanted this for speedup, as there were instances where there were 3 to 5 seconds of
    // waiting on filter changes. But looks like it's causing instability if added.
    // TODO: See if it's still worth doing
    //"eth_getFilterChanges": "after"
  };
};

// Fetch the block before certain requests to make sure we're completely updated
// before those methods are processed. Also, fetch the block after certain requests
// to speed things up.
ReactiveBlockTracker.prototype.handleRequest = function(payload, next, end) {
  var self = this;

  var when = this.methods[payload.method];

  if (when == null) {
    return next();
  }

  function fetchBlock(cb) {
    self.engine._fetchBlock("latest", function(err, block) {
      if (err) return end(err);
      self.engine._setCurrentBlock(block);
      cb();
    });
  }

  if (when == "before") {
    fetchBlock(function() {
      next();
    });
  } else {
    next(function(error, result, cb) {
      fetchBlock(cb);
    });
  }
};


Server = {
  server: function(logger, options) {
    if (logger == null) {
      logger = console;
    }

    var provider = this.provider(logger, options);
    var server = http.createServer(function(request, response) {

      var headers = request.headers;
      var method = request.method;
      var url = request.url;
      var body = [];

      request.on('error', function(err) {
        // console.error(err);
      }).on('data', function(chunk) {
        body.push(chunk);
      }).on('end', function() {
        body = Buffer.concat(body).toString();
        // At this point, we have the headers, method, url and body, and can now
        // do whatever we need to in order to respond to this request.

        var headers = {
          "Access-Control-Allow-Headers": "Origin, X-Requested-With, Content-Type, Accept",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "*"
        };

        switch (method) {
          case "OPTIONS":
            headers["Content-Type"] = "text/plain"
            response.writeHead(200, headers);
            response.end("");
            break;
          case "POST":
            //console.log("Request coming in:", body);

            var payload;
            try {
              payload = JSON.parse(body);
            } catch(e) {
              headers["Content-Type"] = "text/plain";
              response.writeHead(400, headers);
              response.end("400 Bad Request");
              return;
            }

            // Log messages that come into the TestRPC via http
            if (payload instanceof Array) {
              // Batch request
              for (var i = 0; i < payload.length; i++) {
                var item = payload[i];
                logger.log(item.method);
              }
            } else {
              logger.log(payload.method);
            }

            provider.sendAsync(payload, function(err, result) {
              if (err != null) {
                headers["Content-Type"] = "text/plain";
                response.writeHead(500, headers);
                response.end(err.stack);
              } else {
                headers["Content-Type"] = "application/json";
                response.writeHead(200, headers);
                response.end(JSON.stringify(result));
              }
            });

            break;
          default:
            response.writeHead(400, {
              "Access-Control-Allow-Headers": "Origin, X-Requested-With, Content-Type, Accept",
              "Access-Control-Allow-Origin": "*",
              "Access-Control-Allow-Methods": "*",
              "Content-Type": "text/plain"
            });
            response.end("400 Bad Request");
            break;
        }
      });
    });

    server.provider = provider;

    // // TODO: the reviver option is a hack to allow batches to work with jayson
    // // it become unecessary after the fix of this bug https://github.com/ethereum/web3.js/issues/345
    // var server = jayson.server(functions, {
    //   reviver: function(key, val) {
    //     if (typeof val === 'object' && val.hasOwnProperty('method') &&
    //         val.method === 'eth_call' && val.hasOwnProperty('params') &&
    //         val.params.constructor === Array && val.params.length === 1)
    //       val.params.push('latest');
    //     return val;
    //   }
    // });

    return server;
  },

  // TODO: Make this class-like to allow for multiple providers?
  provider: function(logger, options) {
    var self = this;

    if (logger == null) {
      logger = {
        log: function() {}
      };
    }

    var engine = new ProviderEngine();

    var manager = new Manager(logger, options);
    manager.initialize();

    engine.manager = manager;
    engine.addProvider(new ReactiveBlockTracker());
    engine.addProvider(new FilterSubprovider());
    engine.addProvider(new VmSubprovider());
    engine.addProvider(manager);
    engine.setMaxListeners(100);
    engine.start();

    return engine;
  },

  startServer: function(logger, options, callback) {
    var self = this;
    var port = options.port;

    if (port == null) {
      port = 8545;
    }

    if (logger == null) {
      logger = console;
    }

    var server = this.server(logger, options);

    logger.log("EthereumJS TestRPC v" + pkg.version);

    server.provider.manager.waitForInitialization(function(err, accounts) {
      server.listen(port, function() {
        logger.log("");
        logger.log("Available Accounts");
        logger.log("==================");

        accounts = Object.keys(accounts);

        for (var i = 0; i < accounts.length; i++) {
          logger.log(accounts[i]);
        }

        logger.log("");
        logger.log("Listening on localhost:" + port);

        if (callback) {
          callback();
        }
      });
    });
  }
}

module.exports = Server;
