var async = require('async');
var fs = require('fs');
var jshintcli = require('jshint/src/cli');
var lib = require('../modules/lib');
var progressbar = require('../lib/progressbar');
var gn;
var memHistory = [];
var deprecated = require('../deprecated.json');

// configuration name for debug mode
var CONFIG_NAME = 'gracenode-debug';

// keeps memory usage record for up to 1 hour
var MEMHISTORY_LEN = 360;
// checks memory usage every 10 seconds
var MEMWATCH_INTERVAL = 10000;

module.exports.setup = function (gracenode) {
	gn = gracenode;
};

module.exports.exec = function (cb) {
	var config = gn.config.getOne(CONFIG_NAME);
	if (!config) {
		// not in debug mode
		return cb(null, false);
	}
	
	var logger = gn.log.create('debug-mode');

	logger.debug('running the application in DEBUG MODE');

	logger.debug('memory monitoring started');

	startMemWatch(config, logger);

	if (!config.directories) {
		config.directories = [];
	}
	
	var pb = new progressbar.Progressbar(
		config.directories.length,
		{
			color: progressbar.COLORS.GRAY,
			label: 'Scanning source code: '
		}
	);
	var options = {};
	var errors = [];
	var warns = [];

	// apply jshint options if given
	if (config.lintOptions) {
		options.config = config.lintOptions;
		logger.debug('jshint options used:', options.config);
	}

	// set up a lint result reporter function
	options.reporter = function (results) {
		for (var i = 0, len = results.length; i < len; i++) {
			var res = results[i];
			if (res.error) {
				errors.push(res);
			}
		}
	};	

	// done function to be called at the end of all linting
	var done = function (error) {
		// stop progress bar
		pb.end();
		if (error) {
			return cb(error);
		}
		if (warns.length) {
			for (var w = 0, wen = warns.length; w < wen; w++) {
				logger.warn(warns[w]);
			}
		}
		if (errors.length) {
			var erroredFiles = [];
			for (var i = 0, len = errors.length; i < len; i++) {
				if (erroredFiles.indexOf(errors[i].file) === -1) {
					erroredFiles.push(errors[i].file);
				}
				var msg = 'lint error in [' + errors[i].file + ']';
				msg += ' Line ' + errors[i].error.line;
				msg += ' Character ' + errors[i].error.character;
				msg += ' ' + errors[i].error.reason;
				logger.error(msg);
			}
			logger.error(errors.length, 'lint error(s) found in', erroredFiles.length, 'files');
			return cb(new Error('lintError'));
		}
		// we are lint error free
		logger.debug('lint [DONE]: no lint error found');
		cb(null, true);
	};

	var lookForDeprecated = function (list, moveOn) {
		var openFileNumAtATime = 100;
		async.eachLimit(list, openFileNumAtATime, function (file, next) {
			fs.readFile(file, 'utf8', function (error, data) {
				if (error) {
					return next(error);
				}
				for (var i = 0, len = deprecated.length; i < len; i++) {
					var dp = deprecated[i];
					if (data.indexOf(dp.name) !== -1) {
						warns.push(
							'***WARNING: deprecated ' +
							dp.type + ' (' + dp.name + ') used in ' + file +
							' deprecated version of gracenode is ' + dp.version
						);
					}
				}
				next();
			});
		}, moveOn);
	};

	// start progress bar
	pb.start();

	// walk all given directories to check/linit
	async.eachSeries(config.directories, function (item, next) {
		var path = gn.getRootPath() + item;
		lib.walkDir(path, function (error, files) {
			if (error) {
				return next(error);
			}
			// find javascript files only to lint
			var list = [];
			for (var i = 0, len = files.length; i < len; i++) {
				var file = files[i].file;
				if (file.substring(file.lastIndexOf('.') + 1) !== 'js') {
					// not a javascript file
					continue;
				}
				list.push(file);
			}
			// execute jshint
			options.args = list;
			jshintcli.run(options);
			// check for deprecated gracenode functions
			lookForDeprecated(list, next);
			// progressbar
			pb.update();
		});
	}, done);
};

function startMemWatch(config, logger) {
	setTimeout(function () {
		var usage = process.memoryUsage();
		if (memHistory.length === MEMHISTORY_LEN) {
			// discard the oldest memory record
			memHistory.shift();
		}
		memHistory.push(usage);
		var avgUsed = 0;
		for (var i = 0, len = memHistory.length; i < len; i++) {
			avgUsed += memHistory[i].heapUsed;
		}
		var avg = avgUsed / memHistory.length;
		var usedPercentage = ((usage.heapUsed / usage.heapTotal) * 100).toFixed(2);
		var diffPercentage = ((((usage.heapUsed / avg) * 100) - 100).toFixed(2));
		// output the analysis
		var output = {};
		output['memory RSS(resident set size)'] = {
			size: bytesToSize(usage.rss)
		};
		output['memory heap used'] = {
			size: bytesToSize(usage.heapUsed),
			percentage: usedPercentage + '%'
		};
		output['memory heap used average'] = {
			size: bytesToSize(avg),
			percentage: '(used difference: ' + diffPercentage + '%)'
		};
		output['memory heap total'] = {
			size: bytesToSize(usage.heapTotal)
		};
		logger.table(output);
		if (usedPercentage >= 80) {
			logger.warn('***WARNING: memory heap usage is too close to heap total');
		}
		if (diffPercentage >= 50) {
			logger.warn('***WARNING: sudden jump in memory heap used detected');
		}
		// run this in MEMWATCH_INTERVAL seconds again
		startMemWatch(config, logger);
	}, MEMWATCH_INTERVAL);
}

function bytesToSize(bytes) {
	if (bytes === 0) {
		return '0 Byte';
	}
	var k = 1000;
	var sizes = [
		'Bytes',
		'KB',
		'MB',
		'GB',
		'TB',
		'PB',
		'EB',
		'ZB',
		'YB'
	];
	var size = Math.floor(Math.log(bytes) / Math.log(k));
	return (bytes / Math.pow(k, size)).toPrecision(3) + ' ' + sizes[size];
}
