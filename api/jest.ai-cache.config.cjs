const base = require('./package.json').jest;

module.exports = {
  ...base,
  rootDir: '.',
  moduleNameMapper: {
    '^src/(.*)$': '<rootDir>/src/$1',
    '^trends/(.*)$': '<rootDir>/trends/$1',
  },
};
