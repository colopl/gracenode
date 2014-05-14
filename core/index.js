var rootDirName = 'node_modules/gracenode';
var EventEmitter = require('events').EventEmitter;
var async = require('async');
var config = require('../modules/config');
var logger = require('../modules/log');
var log = logger.create('gracenode');
var util = require('util');
var fs = require('fs');
var modPaths = [];
var gracefulWaitList = []; // list of tasks to be executed before shutting down gracenode

var Process = require('./process');

// overwridden by calling _setLogCleaner from log module
// shutdown task for log module. this will be executed at the very end
var logCleaners = [];

module.exports.Gracenode = Gracenode;

function Gracenode() {
	EventEmitter.call(this);
	// listeners
	setupListeners(this);
	// variables
	this._pid = null;
	this._isMaster = false;
	this._configPath = '';
	this._configFiles = [];
	this._modules = ['profiler', 'lib'];
	this._overrideAllowedMods = [];
	this._root = __dirname.substring(0, __dirname.lastIndexOf(rootDirName));
	process.chdir(this._root);
	log.verbose('Working directory changed to', this._root);
}

util.inherits(Gracenode, EventEmitter);

// internal use only
Gracenode.prototype._addLogCleaner = function (name, func) {
	var cleaner = function (done) {
		log.info('shutting down log module...');
		func(function (error) {
			if (error) {
				log.error(error);
			}
			log.info('log module gracefully shutdown');
			done();
		});
	};
	logCleaners.push(cleaner);
};

Gracenode.prototype.registerShutdownTask = function (name, taskFunc) {
	if (typeof taskFunc !== 'function') {
		return log.error('argument 2 must be a function');
	}
	log.info('graceful shutdown task for ' + name + ' has been registered');
	gracefulWaitList.push({ name: name, task: taskFunc });
};

Gracenode.prototype.require = function (path) {
	return require(this.getRootPath() + path);
};

// finds a schema.sql under given module's directory
// never use this function in production, but setup script only
Gracenode.prototype.getModuleSchema = function (modName, cb) {
	var prefix = this.getRootPath();
	var pathList = [rootDirName + '/modules/'];
	pathList = pathList.concat(modPaths);
	async.eachSeries(pathList, function (path, callback) {
		var filePath = prefix + path + modName + '/schema.sql';
		log.verbose('looking for ' + filePath);	
		fs.exists(filePath, function (exists) {
			if (exists) {
				log.verbose(filePath + ' found');
				fs.readFile(filePath, 'utf-8', function (error, sql) {
					if (error) {
						return cb(error);
					}

					log.verbose('module schema:', sql);

					// remove line breaks and tabs
					sql = sql.replace(/(\n|\t)/g, '');
					// separate sql statements
					var sqlList = sql.split(';');
					// remove empty entry in the array
					var list = [];
					for (var i = 0, len = sqlList.length; i < len; i++) {
						if (sqlList[i] !== '') {
							list.push(sqlList[i]);
						}
					}

					log.verbose('module schema queries:', list);

					cb(null, list);
				});
				return;
			}
			callback();
		});
	},
	function () {
		log.verbose(modName + ' schema.sql not found');
		cb(null, []);
	});
};

Gracenode.prototype.getRootPath = function () {
	return this._root;
};

Gracenode.prototype.isMaster = function () {
	return this._isMaster;
};

Gracenode.prototype.getProcessType = function () {
	var ret = {};
	ret.type = this._isMaster ? 'master' : 'worker';
	ret.pid = this._pid;
	return ret;
};

Gracenode.prototype.setConfigPath = function (configPath) {
	this._configPath = this._root + configPath;
	log.verbose('configuration path:', this._configPath);
};

Gracenode.prototype.setConfigFiles = function (fileList) {
	this._configFiles = fileList;
	log.verbose('configuration file list:', fileList);
};

Gracenode.prototype.addModulePath = function (path) {
	if (modPaths.indexOf(path) !== -1) {
		return log.warning('module path has already been added:', path);
	}
	modPaths.push(path);
	log.verbose('module path has been added:', path);
};

Gracenode.prototype.exit = function (error) {
	this.emit('exit', error || 0);
};

// depricated as of version 0.2.30
Gracenode.prototype.allowOverride = function (builtInModuleName) {
	this._overrideAllowedMods.push(builtInModuleName);
};

Gracenode.prototype.override = function (builtInModuleName) {
	this._overrideAllowedMods.push(builtInModuleName);
	this.use(builtInModuleName);	
};

Gracenode.prototype.use = function (modName) {
	if (this._modules.indexOf(modName) === -1) {
		this._modules.push(modName);
	}
};

Gracenode.prototype.setup = function (cb) {
	if (!this._configPath) {
		return this.exit(new Error('path to configuration files not set'));
	}
	if (!this._configFiles.length) {
		return this.exit(new Error('configuration files not set'));
	}
	var that = this;
	var starter = function (callback) {
		log.verbose('gracenode is starting...');
		callback(null, that, cb);
	};
	var setupList = [
		starter, 
		setupConfig, 
		setupLog, 
		setupProfiler,
		setupProcess, 
		setupModules
	];
	async.waterfall(setupList, function (error) {
		if (error) {
			log.fatal(error);
			log.fatal('gracenode failed to set up');
			return that.exit(error);
		}

		log.verbose('gracenode set up complete');

		that.emit('setup.complete');
		
		cb();

		that._profiler.stop();
	});
};

function setupConfig(that, lastCallback, cb) {
	config.setPath(that._configPath);
	config.load(that._configFiles, function (error) {
		if (error) {
			return cb(error);
		}
		that.config = config;

		log.verbose('config is ready');

		that.emit('setup.config');

		cb(null, that, lastCallback);
	});
}

function setupLog(that, lastCallback, cb) {
	logger.gracenode = that;
	logger.readConfig(config.getOne('modules.log'));
	logger.setup(function (error) {
		if (error) {
			return lastCallback(error);
		}
		log.config = config.getOne('modules.log');
		that.log = logger;
		
		log.verbose('log is ready');

		that.emit('setup.log');

		cb(null, that, lastCallback);
	});
}

function setupProfiler(that, lastCallback, cb) {
	var profiler = require('../modules/profiler');

	// gracenode profiler
	that._profiler = profiler.create(rootDirName);
	that._profiler.start();	

	// profiler for others
	that.profiler = profiler;

	log.verbose('profiler is ready');

	that.emit('setup._profiler');

	cb(null, that, lastCallback);	
}

function setupProcess(that, lastCallback, cb) {
	var ps = new Process(that);
	ps.on('cluster.master.setup', function (pid) {
		that._pid = pid;
		logger.setPrefix('MASTER:' + pid);
		log = logger.create('gracenode');
		lastCallback();
	});
	ps.on('cluster.worker.setup', function (pid) {
		that._pid = pid;
		logger.setPrefix('WORKER:' + pid);
		log = logger.create('gracenode');
		cb(null, that);
	});
	ps.on('nocluster.setup', function () {
		cb(null, that);
	});
	ps.setup();	
}

function loadModule(that, name, cb) {
	// this variable will remember the found built-in module for allowed override case
	var builtInMod = null;
	try {
		// first try inside gracenode
		var path = that.getRootPath() + rootDirName + '/modules/' + name;
		fs.exists(path, function (exists) {
			log.verbose('look for module [' + name + '] in', path);
			if (exists) {
				log.verbose('module [' + name + '] found');
				// check if this module is allowed to be overridden
				if (that._overrideAllowedMods.indexOf(name) !== -1) {
					// override allowed
					log.verbose('module [' + name + '] is allowed to be overridden by custom module of the same name');
					builtInMod = path;
				} else {
					// override NOT allowed
					return cb(null, require(path));
				}
			}
			// try other path(s)
			async.eachSeries(modPaths, function (dir, callback) {
				dir = that.getRootPath() + dir + name;
				fs.exists(dir, function (exists) {
					log.verbose('look for module [' + name + '] in', dir);
					if (exists) {
						log.verbose('module [' + name + '] found');
						if (builtInMod) {
							log.verbose('override the built-in module with the custom module [' + name + ']');
						}
						return cb(null, require(dir));
					}
					callback();
				});
			},
			function () {
				// check if we found module or not
				if (builtInMod) {
					// overriding was allowed but custom module to override the built-in module was NOT found > use the built-in module
					log.verbose('load the built-in module [' + name + ']');
					return cb(null, require(builtInMod));
				}
				// no module by the given name was found
				cb(new Error('failed to find module [' + name + ']'));
			});
		});
	} catch (exception) {
		cb(exception);
	}
}

function setupModules(that, cb) {
	log.verbose('start loading built-in modules');
	async.eachSeries(that._modules, function (name, nextCallback) {

		loadModule(that, name, function (error, module) {

			if (error) {
				return cb(error);
			}

			that[name] = module;

			if (typeof module.readConfig === 'function') {
				log.verbose('module [' + name + '] reading configurations: modules.' + name);
				var status = module.readConfig(config.getOne('modules.' + name));
				if (status instanceof Error) {
					return cb(status);
				}
			}
		
			if (typeof module.setup === 'function') {
				module.setup(function (error) {
					if (error) {
						return cb(error);
					}
					that._profiler.mark('module [' + name + '] loaded');
					log.verbose('module [' + name + '] loaded');
					that.emit('setup.' + name);
					nextCallback();
				});
			} else {
				that._profiler.mark('module [' + name + '] loaded');
				log.verbose('module [' + name + '] loaded');
				that.emit('setup.' + name);
				nextCallback();
			}
		});
	}, cb);
}

function handleShutdownTasks(cb) {
	if (!gracefulWaitList.length) {
		return cb();
	}
	// execute shutdown tasks
	async.eachSeries(gracefulWaitList, function (item, next) {
		log.info('handling graceful exit task for', item.name);
		try {
			item.task(function (error) {
				if (error) {
					log.error('shutdown task <' + item.name + '>', error);
				}
				next();
			});
		} catch (e) {
			log.fatal('shutdown task <' + item.name + '>', e);
			next();
		}
	},
	function () {
		gracefulWaitList = [];
		log.info('all shutdown tasks have been executed');
		cb();
	});
}

function setupListeners(that) {

	that.on('exit', function (error) {
		log.info('exit caught: shutting down gracenode...');
		handleShutdownTasks(function () {
			if (error) {
				log.fatal('exit gracenode with an error:', error);
			}
			async.eachSeries(logCleaners, function (cleaner, next) {
				cleaner(next);
			},
			function () {
				log.info('exit gracenode');
				process.exit(error ? 1: 0);
			});
		});
	});
	
	process.on('uncaughtException', function (error) {
		log.fatal('gracenode detected an uncaught exception');
		log.fatal(error);
		that.emit('uncaughtException', error);
	});

	process.on('SIGINT', function () {
		log.info('SIGINT caught: shutting down gracenode...');
		handleShutdownTasks(function () {
			log.info('shutdown gracenode');
			that.emit('shutdown');
			that.exit();
		});
	});

	process.on('SIGQUIT', function () {
		log.info('SIGQUIT caught: shutting down gracenode...');
		handleShutdownTasks(function () {
			log.info('quit gracenode');
			that.emit('shutdown');
			that.exit();
		});
	});

	process.on('SIGTERM', function () {
		log.info('SIGTERM caught: shutting down gracenode...');
		handleShutdownTasks(function () {
			log.info('terminate gracenode');
			that.emit('shutdown');
			that.exit();
		});
	});
}
