// @flow
function isLineTooLong(line: string, maxLineLength: number): boolean {
  return !!maxLineLength && line.length > maxLineLength;
}

function equalsAndValue({
  declarationKeyword,
  importFunction,
  path,
}: {
    declarationKeyword: ?string,
    importFunction: ?string,
    path: string,
  }): Object {
  if (declarationKeyword === 'import') {
    return { equals: 'from', value: `'${path}';` };
  }
  return { equals: '=', value: `${importFunction || 'require'}('${path}');` };
}

/**
 * Class that represents an import statement, e.g.
 * `const foo = require('foo');`
 * `var foo = myCustomRequire('foo');`
 * `import foo from 'foo';`
 */
export default class ImportStatement {
  assignment: ?string;
  declarationKeyword: ?string;
  hasTypeKeyword: ?boolean;
  defaultImport: ?string;
  hasSideEffects: boolean;
  importFunction: ?string;
  namedImports: Array<Object>;
  areOnlyTypes: boolean; // true if namedImports are all 'type' imports
  originalImportString: ?string;
  leadingContent: ?string;
  path: string;
  danglingCommas: boolean;

  constructor({
    assignment,
    declarationKeyword,
    hasTypeKeyword,
    defaultImport,
    hasSideEffects,
    importFunction,
    namedImports = [],
    areOnlyTypes = false,
    originalImportString,
    leadingContent,
    path,
    danglingCommas = true,
  }: {
      assignment?: ?string,
      declarationKeyword?: ?string,
      hasTypeKeyword?: ?boolean,
      defaultImport?: ?string,
      hasSideEffects: boolean,
      importFunction?: ?string,
      namedImports?: Array<Object>,
      areOnlyTypes?: boolean,
      originalImportString?: ?string,
      leadingContent?: ?string,
      path: string,
      danglingCommas: boolean
    } = {}) {
    this.assignment = assignment;
    this.declarationKeyword = declarationKeyword;
    this.hasTypeKeyword = hasTypeKeyword;
    this.defaultImport = defaultImport;
    this.hasSideEffects = hasSideEffects || !!namedImports.find(n => n.localName.startsWith('<'));
    this.importFunction = importFunction;
    this.namedImports = namedImports.filter(n => !n.localName.startsWith('<'));
    this.areOnlyTypes = areOnlyTypes;
    this.originalImportString = originalImportString;
    this.leadingContent = leadingContent;
    this.path = path;
    this.danglingCommas = danglingCommas;
  }

  hasVariable(variableName: string): boolean {
    if (variableName === this.defaultImport) {
      return true;
    }
    return !!this.namedImports.find(({
      localName,
    }: {
      localName: string,
    }): boolean => localName === variableName);
  }

  /**
   * Deletes a variable from an already existing default import or set of
   * named imports.
   */
  deleteVariable(variableName: string) {
    let touched = false;

    if (this.defaultImport === variableName) {
      delete this.defaultImport;
      touched = true;
    }

    if (this.hasNamedImports()) {
      const variableIndex = this.namedImports.findIndex(({
        localName,
      }: {
        localName: string,
      }): boolean =>
        localName === variableName);
      if (variableIndex !== -1) {
        this.namedImports.splice(variableIndex, 1);
        touched = true;
      }
    }

    if (touched) {
      this._clearImportStringCache();
    }
  }

  /**
   * @return {Boolean} true if there are named imports
   */
  hasNamedImports(): boolean {
    return !!this.namedImports && this.namedImports.length > 0;
  }

  /**
   * @return {Boolean} true if there is no default import, no named imports, and
   *   no side effects.
   */
  isEmpty(): boolean {
    return !this.defaultImport &&
      !this.hasNamedImports() &&
      !this.hasSideEffects;
  }

  /**
   * @return {Boolean} true if this instance was created through parsing an
   *   existing import and it hasn't been altered since it was created.
   */
  isParsedAndUntouched(): boolean {
    return !!this.originalImportString;
  }

  /**
   * @return {Array} an array that can be used in `sort` and `uniq`
   */
  toNormalized(): Array<string> {
    if (!this.defaultImport && !this.hasNamedImports() && this.hasSideEffects) {
      return [this.path];
    }
    return [this.defaultImport || '', ...this.localNames()];
  }

  localNames(): Array<string> {
    if (!this.namedImports) {
      return [];
    }
    return this.namedImports.map(({
      localName,
    }: {
      localName: string
    }): string => localName);
  }

  /**
   * @return {Array<String>} Array of all variables that this ImportStatement
   *   imports.
   */
  variables(): Array<string> {
    return [this.defaultImport, ...this.localNames()].filter(Boolean);
  }

  toImportStrings(maxLineLength: number, tab: string): Array<string> {
    const strings = this._importStrings(maxLineLength, tab);

    if (this.leadingContent && strings.length > 0) {
      strings[0] = this.leadingContent + strings[0];
    }

    return strings;
  }

  _importStrings(maxLineLength: number, tab: string): Array<string> {
    if (this.originalImportString) {
      return [this.originalImportString];
    }

    if (this.hasSideEffects && !this.hasNamedImports() && !this.defaultImport) {
      // this is a side-effect import only
      return [this._assignmentLessImportString()];
    }

    if (this.declarationKeyword === 'import') {
      // ES2015 Modules (ESM) syntax can support default imports and
      // named imports on the same line.
      if (this.hasNamedImports()) {
        return [this._namedImportString(maxLineLength, tab)];
      }
      return [this._defaultImportString(maxLineLength, tab)];
    }

    // const/var
    const strings = [];
    if (this.defaultImport) {
      strings.push(this._defaultImportString(maxLineLength, tab));
    }
    if (this.hasNamedImports()) {
      strings.push(this._namedImportString(maxLineLength, tab));
    }
    return strings;
  }

  /**
   * Merge another ImportStatement into this one.
   */
  merge(importStatement: ImportStatement) {
    if (
      importStatement.defaultImport &&
      this.defaultImport !== importStatement.defaultImport
    ) {
      this.defaultImport = importStatement.defaultImport;
      this._clearImportStringCache();
    }

    if (
      importStatement.hasSideEffects &&
      this.hasSideEffects !== importStatement.hasSideEffects
    ) {
      // If a module is ever thought to have side-effects, then assume it does.
      this.hasSideEffects = true;
      this._clearImportStringCache();
    }

    if (importStatement.hasNamedImports()) {
      this.namedImports = this.namedImports || [];
      const originalNamedImports = this.namedImports.slice(0); // clone array

      let modified = false;

      importStatement.namedImports.forEach((named: Object) => {
        const namedImport = originalNamedImports.find(({
          localName,
        }: {
          localName: string,
        }): boolean =>
          localName === named.localName);
        if (!namedImport) {
          this.namedImports.push(named);
          modified = true;
          if (this.areOnlyTypes && !named.isType) {
            this.areOnlyTypes = false;
          }
        }
      });
      if (modified) {
        this.namedImports.sort((a: Object, b: Object): number => {
          if (a.localName < b.localName) {
            return -1;
          }
          if (a.localName > b.localName) {
            return 1;
          }
          return 0;
        });
        this._clearImportStringCache();
      }
    }

    if (this.declarationKeyword !== importStatement.declarationKeyword) {
      this.declarationKeyword = importStatement.declarationKeyword;
      this._clearImportStringCache();
    }
  }

  _assignmentLessImportString(): string {
    if (this.declarationKeyword === 'import') {
      return `import '${this.path}';`;
    }

    return `${this.importFunction || 'require'}('${this.path}');`;
  }

  _defaultImportString(maxLineLength: number, tab: string): string {
    const { equals, value } = equalsAndValue({
      declarationKeyword: this.declarationKeyword,
      importFunction: this.importFunction,
      path: this.path,
    });

    const line = `${this.declarationKeyword || ''} ${this.defaultImport || ''} ${equals} ${value}`;
    if (!isLineTooLong(line, maxLineLength)) {
      return line;
    }

    return `${this.declarationKeyword || ''} ${this.defaultImport || ''} ${equals}\n${tab}${value}`;
  }

  _namedImportString(maxLineLength: number, tab: string): string {
    const { equals, value } = equalsAndValue({
      declarationKeyword: this.declarationKeyword,
      importFunction: this.importFunction,
      path: this.path,
    });

    let prefix = '';
    if (this.declarationKeyword === 'import') {
      if (this.defaultImport) {
        prefix = `${this.defaultImport}, `;
      } else if (this.areOnlyTypes) {
        prefix = 'type ';
      }
    }

    const named = this.namedImports.map(({
      localName,
      importedName,
      isType,
    }: {
      localName: string,
      importedName: ?string,
      isType?: boolean,
    }): string => {
      const typePrefix = isType && (!this.areOnlyTypes || this.defaultImport) ? 'type ' : '';
      if (!importedName) {
        return `${typePrefix}${localName}`;
      }
      return `${typePrefix}${importedName} as ${localName}`;
    });

    const namedOneLine = `{ ${named.join(', ')} }`;
    const line = `${this.declarationKeyword || ''} ${prefix}${namedOneLine} ${equals} ${value}`;
    if (!isLineTooLong(line, maxLineLength)) {
      return line;
    }

    const tabJoined = named.join(`,\n${tab}`);
    const namedMultiLine = `{\n${tab}${tabJoined}${this.danglingCommas ? ',' : ''}\n}`;
    return `${this.declarationKeyword || ''} ${prefix}${namedMultiLine} ${equals} ${value}`;
  }

  _clearImportStringCache() {
    delete this.originalImportString;
  }
}
