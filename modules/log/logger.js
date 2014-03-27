var ip = require('./lib/ip');
var msg = require('./lib/msg');
var file = require('./lib/file');
var remote = require('./lib/remote');
var mongodb = require('./lib/mongodb');

module.exports.setup = function (gn, config, cb) {
	ip.setup();
	msg.setup(config);
	file.setup(gn, config.level, config.file);
	remote.setup(config.remote);
	mongodb.setup(gn, config.mongodb, cb);
};

module.exports.Logger = Logger;

function Logger(prefix, name, config) {
	this.prefix = prefix;
	this.name = name;
	this.config = config;
}

Logger.prototype.verbose = function () {
	this._handleLog('verbose', arguments);
};

Logger.prototype.debug = function () {
	this._handleLog('debug', arguments);
};

Logger.prototype.info = function () {
	this._handleLog('info', arguments);
};

Logger.prototype.warning = function () {
	this._handleLog('warning', arguments);
};

Logger.prototype.error = function () {
	this._handleLog('error', arguments);
};

Logger.prototype.fatal = function () {
	this._handleLog('fatal', arguments);
};

Logger.prototype._handleLog = function (levelName, message) {
	// check enabled or not
	if (this.config && this.config.level && !this.config.level[levelName]) {
		// not enabled
		return;
	}

	var logMsg = msg.create(this.prefix, this.name, levelName, message);
	
	console.log(logMsg);
	
	if (this.config && this.config.level && this.config.level[levelName] && this.config.level[levelName]) {
		outputLog(this.config, levelName, logMsg);
	}
};

function outputLog(config, levelName, logMsg) {
	
	if (config.file) {
		file.log(levelName, logMsg);
	}

	if (config.remote) {
		remote.log(levelName, logMsg);
	}

	if (config.mongodb) {
		mongodb.log(levelName, logMsg);
	}
	
	return true;
}