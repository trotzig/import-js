// @flow
const TYPESCRIPT_FILE_PATH_REGEX = /\.tsx?$/;
const COFFEESCRIPT_FILE_PATH_REGEX = /\.coffee$/;

function getParserPlugins(absolutePathToFile: string): Array<string | [string, Object]> {
  const typePlugin = TYPESCRIPT_FILE_PATH_REGEX.test(absolutePathToFile)
    ? 'typescript'
    : 'flow';

  return [
    typePlugin,
    'jsx',
    'doExpressions',
    'objectRestSpread',
    'decorators-legacy',
    'classProperties',
    'classPrivateProperties',
    'classPrivateMethods',
    'exportExtensions',
    'asyncGenerators',
    'functionBind',
    'functionSent',
    'dynamicImport',
    'numericSeparator',
    'optionalChaining',
    'importMeta',
    'bigInt',
    'optionalCatchBinding',
    'throwExpressions',
    ['pipelineOperator', {
      proposal: 'minimal',
    }],
    'nullishCoalescingOperator',
    'exportNamespaceFrom',
    'exportDefaultFrom',
  ];
}

export default function parse(fileContent: string, absolutePathToFile: string): Object {
  // For some reason, we can't `import` @babel/parser using an es6 import.
  // eslint-disable-next-line global-require
  const babelParser = require('@babel/parser');

  if (COFFEESCRIPT_FILE_PATH_REGEX.test(absolutePathToFile)) {
    const coffee = require('coffeescript');
    fileContent = coffee.compile(fileContent, {
      bare: true,
      noHeader: true,
      transpile: true
    });
  }

  return babelParser.parse(fileContent, {
    allowImportExportEverywhere: true,
    plugins: getParserPlugins(absolutePathToFile),
    sourceType: 'module',
  });
}
