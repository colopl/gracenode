var fs = require('fs');
var net = require('net');
var spawn = require('child_process').spawn;
var gn = require('../../');
var socketName = require('./socket-name');
var path;
var app;
// if the application dies 10 times in 10 seconds, monitor will exit
var maxNumOfDeath = 10;
var deathInterval = 10000;
var timeOfDeath = 0;
var deathCount = 0;
var restartTime = 0;
var Log = require('./log'); 
var logger = new Log(gn.argv('--log'));

// start file logging stream if enabled
logger.start(gn.argv('start')[0] || null);

gn.on('uncaughtException', function (error) {
	gn.exit(error);
});

gn.registerShutdownTask('exit', function (done) {
	handleExit();
	done();
});

gn.setConfigPath('node_modules/gracenode/scripts/configs/');
gn.setConfigFiles(['gracenode.json']);

gn.defineOption('start', 'Starts a monitor process to spawn and monitor application process(s).', function (pathIn) {
	path = pathIn[0] || null;
	var monitorServer = net.createServer(function (sock) {
		sock.on('error', handleExit);
		sock.on('data', handleCommunication);
	});
	var sockFile = socketName(path);
	monitorServer.listen(sockFile);
	startApp();
});

gn.setup(function () {});

function handleExit(error) {
	if (error) {
		logger.error('daemon monitor exiting with an error: ' + error);
	}
	logger.stop();
	fs.unlinkSync(socketName(path));
	process.exit(error || 0);
}

function handleCommunication(msg) {
	// handle the command
	var command = msg.toString();
	switch (command) {
		case 'stop':
			// we instruct the application process to exit and exit monitor process
			stopApp(handleExit);
			break;
		case 'restart':
			// we instruct the application process to exit and let monitor process to respawn it
			if (Date.now() - restartTime > deathInterval) {
				restartTime = Date.now();
				stopApp();
			}
			break;
		default:
			logger.error('unknown command: ' + command);
			break;
	}
}

function startApp() {
	app = spawn(process.execPath, [path, '--daemon'], { detached: true, stdio: 'ignore' });
	app.path = path;
	logger.info('started daemon process of ' + path);
	// if appllication dies unexpectedly, respawn it
	app.once('exit', function () {
		deathCount += 1;
		logger.info('daemon process of ' + path + ' has exited: count of death [' + deathCount + '/' + maxNumOfDeath + ']');
		if (deathCount === 1) {
			// application died for the first time
			timeOfDeath = Date.now();
		}
		if (deathCount >= maxNumOfDeath) {
			var now = Date.now();
			if (now - timeOfDeath <= deathInterval) {
				// the application is dying way too fast and way too often
				return handleExit(new Error('appliation [' + path + '] is dying too fast and too aften'));
			}
			// application has died more than maxNumOfDeath but not too fast...
			deathCount = 0;
		}
		// respawn application process
		startApp();
	});

}

function stopApp(cb) {
	if (app) {
		app.kill();
		logger.info('stopped daemon process of ' + app.path);
		if (cb) {
			cb();
		}
	}
}
