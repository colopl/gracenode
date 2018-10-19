var assert = require('assert');

module.exports.GET = function (req, res) {
    var parameters = req.parameters ? req.parameters : null;
    var boo = req.data ? req.data('boo') : req.query.boo;
    var foo = req.data ? req.data('foo') : req.query.foo;
    var f_oo = req.data ? req.data('f oo') : req.query['f oo'];
    assert(req.requestId || req.id);
    if (parameters === null) {
        parameters = [];
        for (var i in req.params) {
            parameters.push(req.params[i]);
        }
    }
    res.json({ boo: boo, foo: foo, 'f oo': f_oo, parameters: parameters });
};
