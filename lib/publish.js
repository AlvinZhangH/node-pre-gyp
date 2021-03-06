'use strict';

module.exports = exports = publish;

exports.usage = 'Publishes pre-built binary (requires aws-sdk)';

const fs = require('fs');
const path = require('path');
const log = require('npmlog');
const versioning = require('./util/versioning.js');
const napi = require('./util/napi.js');
const s3_setup = require('./util/s3_setup.js');
const existsAsync = fs.exists || path.exists;
const url = require('url');

function publish(gyp, argv, callback) {
  const package_json = gyp.package_json;
  const config = gyp.rc;
  const napi_build_version = napi.get_napi_build_version_from_command_args(argv);
  const opts = versioning.evaluate(package_json, gyp.opts, napi_build_version);
  const tarball = opts.staged_tarball;
  existsAsync(tarball, (found) => {
    if (!found) {
      return callback(new Error('Cannot publish because ' + tarball + ' missing: run `node-pre-gyp package` first'));
    }

    log.info('publish', 'Detecting s3 credentials');
    s3_setup.detect(opts.hosted_path, config);
    const s3 = s3_setup.get_s3(config);

    const key_name = url.resolve(config.prefix, opts.package_name);
    const s3_opts = {
      Bucket: config.bucket,
      Key: key_name
    };
    log.info('publish', 'Authenticating with s3');
    log.info('publish', config);

    const remote_package = 'https://' + s3_opts.Bucket + '.s3.amazonaws.com/' + s3_opts.Key;
    log.info('publish', 'Checking for existing binary at ' + remote_package);
    s3.headObject(s3_opts, (err, meta) => {
      if (meta) log.info('publish', JSON.stringify(meta));
      if (err && err.code === 'NotFound') {
        // we are safe to publish because
        // the object does not already exist
        log.info('publish', 'Preparing to put object');

        // const s3_put = new AWS.S3();
        const s3_put_opts = {
          ACL: config.acl,
          Body: fs.createReadStream(tarball),
          Bucket: config.bucket,
          Key: key_name
        };
        log.info('publish', 'Putting object', s3_put_opts.ACL, s3_put_opts.Bucket, s3_put_opts.Key);
        try {
          s3.putObject(s3_put_opts, (err2, resp) => {
            log.info('publish', 'returned from putting object');
            if (err2) {
              log.info('publish', 's3 putObject error: "' + err2 + '"');
              return callback(err2);
            }
            if (resp) log.info('publish', 's3 putObject response: "' + JSON.stringify(resp) + '"');
            log.info('publish', 'successfully put object');
            console.log('[' + package_json.name + '] published to ' + remote_package);
            return callback();
          });
        } catch (err3) {
          log.info('publish', 's3 putObject error: "' + err3 + '"');
          return callback(err3);
        }
      } else if (err) {
        log.info('publish', 's3 headObject error: "' + err + '"');
        return callback(err);
      } else {
        log.error('publish', 'Cannot publish over existing version');
        log.error('publish', "Update the 'version' field in package.json and try again");
        log.error('publish', 'If the previous version was published in error see:');
        log.error('publish', '\t node-pre-gyp unpublish');
        return callback(new Error('Failed publishing to ' + remote_package));
      }
    });
  });
}
