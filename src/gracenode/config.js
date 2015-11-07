'use strict';

var gn = require('../gracenode/');
var config = {};

exports.load = function (configObj) {
	for (var i in configObj) {
		if (!config.hasOwnProperty(i)) {
			config[i] = configObj[i];
		} else {
			config[i] = merge(i, config, configObj);
		}
	}
};

// dotted notation is supported
exports.get = function (propName) {
	if (!propName) {
		return gn.lib.cloneObj(config);
	}
	var propNames = [];
	if (propName.indexOf('.') !== -1) {
		// split it by period
		propNames = propName.split('.');
	} else {
		propNames.push(propName);
	}
	// this is to indicate if we found a match of configurations at least once or not
	// if found is false, we return null
	var found = false;
	var conf = config;
	for (var i = 0, len = propNames.length; i < len; i++) {
		var prop = propNames[i];
		if (conf[prop] !== undefined) {
			conf = conf[prop];
			found = true;
		} else {
			// if the configurations you are looking for is not found, return null
			conf = null;
			break;
		}
	}
	if (!found) {
		conf = null;
	}
	return gn.lib.cloneObj(conf);
};

function merge(key, origin, obj) {
	if (typeof origin[key] === 'object' && typeof obj[key] === 'object') {
		if (Array.isArray(origin[key]) && Array.isArray(obj[key])) {
			origin[key] = origin[key].concat(obj[key]);
		} else {
			for (var i in obj[key]) {
				origin[key][i] = merge(i, origin[key], obj[key]);
			}
		}
	} else {
		origin[key] = obj[key]; 
	}
	return origin[key];
}