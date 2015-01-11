'use strict';
before(function() {
  global.chai = require('chai');

  // Load dirty chai first to hook plugin extensions
  var dirtyChai = require('dirty-chai');
  chai.use(dirtyChai);

  global.should = chai.should();
  global.expect = chai.expect;
  global.sinon = require('sinon');

  var Bluebird = require('bluebird'),
      chaiAsPromised = require('chai-as-promised'),
      sinonChai = require('sinon-chai'),
      sinonAsPromised = require('sinon-as-promised')(Bluebird),
      _ = require('lodash');


  chai.use(sinonChai);
  chai.use(chaiAsPromised);
});
