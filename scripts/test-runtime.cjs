// The Windows sandbox can return ENOMEM from os.userInfo(), which tsx uses only
// to choose a cache directory. Keep this scoped to the test process so tests can
// report real application failures instead of failing during runner startup.
const os = require('node:os');

try {
  os.userInfo();
} catch (error) {
  const original = os.userInfo;
  os.userInfo = (...args) => {
    try {
      return original(...args);
    } catch {
      return {
        uid: -1,
        gid: -1,
        username: process.env.USERNAME || 'sarraf-test-runner',
        homedir: os.tmpdir(),
        shell: null,
      };
    }
  };
}
