/*---------------------------------------------------------------------------------------------
 *  Tests for the scalaruri custom tag type.
 *
 *  The scalaruri type transforms tagged scalars (e.g. !include file.yaml) into
 *  URI-like strings (tag+include://file.yaml) during validation, enabling JSON
 *  Schemas to enforce that custom tags are present via pattern matching.
 *--------------------------------------------------------------------------------------------*/
import { setupLanguageService, setupTextDocument, SCHEMA_ID, setupSchemaIDTextDocument, TestCustomSchemaProvider } from './utils/testHelper';
import { ServiceSetup } from './utils/serviceSetup';
import { createExpectedError } from './utils/verifyError';
import * as assert from 'assert';
import { Diagnostic } from 'vscode-languageserver-types';
import { LanguageService } from '../src/languageservice/yamlLanguageService';
import { ValidationHandler } from '../src/languageserver/handlers/validationHandlers';
import { SettingsState, TextDocumentTestManager } from '../src/yamlSettings';

describe('ScalarURI Custom Tag Tests', () => {
  let languageSettingsSetup: ServiceSetup;
  let languageService: LanguageService;
  let validationHandler: ValidationHandler;
  let yamlSettings: SettingsState;
  let schemaProvider: TestCustomSchemaProvider;

  before(() => {
    languageSettingsSetup = new ServiceSetup()
      .withValidate()
      .withCustomTags(['!include scalaruri', '!var scalaruri', '!module scalaruri', '!Ref scalar']);
    const {
      languageService: langService,
      validationHandler: valHandler,
      yamlSettings: settings,
      schemaProvider: testSchemaProvider,
    } = setupLanguageService(languageSettingsSetup.languageSettings);
    languageService = langService;
    validationHandler = valHandler;
    yamlSettings = settings;
    schemaProvider = testSchemaProvider;
  });

  /**
   * Helper that configures custom tags on both the language service (for parsing)
   * and yamlSettings (for the scalaruri transformation in validationHandlers).
   */
  function parseSetup(content: string, customTags: string[]): Promise<Diagnostic[]> {
    const testTextDocument = setupSchemaIDTextDocument(content);
    languageSettingsSetup.languageSettings.customTags = customTags;
    languageService.configure(languageSettingsSetup.languageSettings);
    yamlSettings.customTags = customTags;
    yamlSettings.documents = new TextDocumentTestManager();
    (yamlSettings.documents as TextDocumentTestManager).set(testTextDocument);
    return validationHandler.validateTextDocument(testTextDocument);
  }

  afterEach(() => {
    schemaProvider.deleteSchema(SCHEMA_ID);
  });

  describe('Parsing - scalaruri tags should not produce parse errors', () => {
    it('scalaruri tag on a scalar value', (done) => {
      const content = 'key: !include file.yaml';
      parseSetup(content, ['!include scalaruri'])
        .then((result) => {
          assert.equal(result.length, 0);
        })
        .then(done, done);
    });

    it('scalaruri tag in a sequence item', (done) => {
      const content = 'steps:\n  - !include step1.yaml\n  - !include step2.yaml';
      parseSetup(content, ['!include scalaruri'])
        .then((result) => {
          assert.equal(result.length, 0);
        })
        .then(done, done);
    });

    it('multiple different scalaruri tags', (done) => {
      const content = 'template: !include file.yaml\npath: !var output_path';
      parseSetup(content, ['!include scalaruri', '!var scalaruri'])
        .then((result) => {
          assert.equal(result.length, 0);
        })
        .then(done, done);
    });

    it('mixing scalaruri and scalar tags', (done) => {
      const content = 'template: !include file.yaml\nref: !Ref some_value';
      parseSetup(content, ['!include scalaruri', '!Ref scalar'])
        .then((result) => {
          assert.equal(result.length, 0);
        })
        .then(done, done);
    });
  });

  describe('Schema validation - scalaruri transformation enables pattern enforcement', () => {
    it('!include tag passes pattern validation', (done) => {
      schemaProvider.addSchema(SCHEMA_ID, {
        type: 'object',
        properties: {
          template: {
            type: 'string',
            pattern: '^tag\\+include://.+\\.(yaml|yml)$',
          },
        },
      });
      const content = 'template: !include report.yaml';
      parseSetup(content, ['!include scalaruri'])
        .then((result) => {
          assert.equal(result.length, 0);
        })
        .then(done, done);
    });

    it('plain string without tag fails pattern validation', (done) => {
      schemaProvider.addSchema(SCHEMA_ID, {
        type: 'object',
        properties: {
          template: {
            type: 'string',
            pattern: '^tag\\+include://.+\\.(yaml|yml)$',
          },
        },
      });
      const content = 'template: report.yaml';
      parseSetup(content, ['!include scalaruri'])
        .then((result) => {
          assert.ok(result.length > 0, 'Expected validation errors for missing tag');
        })
        .then(done, done);
    });

    it('wrong tag type fails pattern validation', (done) => {
      schemaProvider.addSchema(SCHEMA_ID, {
        type: 'object',
        properties: {
          template: {
            type: 'string',
            pattern: '^tag\\+include://.+\\.(yaml|yml)$',
          },
        },
      });
      const content = 'template: !var report.yaml';
      parseSetup(content, ['!include scalaruri', '!var scalaruri'])
        .then((result) => {
          assert.ok(result.length > 0, 'Expected validation errors for wrong tag');
        })
        .then(done, done);
    });

    it('!var tag passes its own pattern validation', (done) => {
      schemaProvider.addSchema(SCHEMA_ID, {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            pattern: '^tag\\+var://.+$',
          },
        },
      });
      const content = 'path: !var output_path';
      parseSetup(content, ['!var scalaruri'])
        .then((result) => {
          assert.equal(result.length, 0);
        })
        .then(done, done);
    });

    it('oneOf with inline array or !include file reference', (done) => {
      schemaProvider.addSchema(SCHEMA_ID, {
        type: 'object',
        properties: {
          variables: {
            oneOf: [
              {
                type: 'array',
                items: { type: 'object' },
              },
              {
                type: 'string',
                pattern: '^tag\\+include://.+\\.(yaml|yml)$',
              },
            ],
          },
        },
      });
      const content = 'variables: !include vars.yaml';
      parseSetup(content, ['!include scalaruri'])
        .then((result) => {
          assert.equal(result.length, 0);
        })
        .then(done, done);
    });

    it('oneOf with inline array - inline array still works', (done) => {
      schemaProvider.addSchema(SCHEMA_ID, {
        type: 'object',
        properties: {
          variables: {
            oneOf: [
              {
                type: 'array',
                items: { type: 'object' },
              },
              {
                type: 'string',
                pattern: '^tag\\+include://.+\\.(yaml|yml)$',
              },
            ],
          },
        },
      });
      const content = 'variables:\n  - name: threshold\n    type: float';
      parseSetup(content, ['!include scalaruri'])
        .then((result) => {
          assert.equal(result.length, 0);
        })
        .then(done, done);
    });

    it('pattern accepting multiple tag types', (done) => {
      schemaProvider.addSchema(SCHEMA_ID, {
        type: 'object',
        properties: {
          source: {
            type: 'string',
            pattern: '^tag\\+(include|var)://.+$',
          },
        },
      });
      const content = 'source: !var my_variable';
      parseSetup(content, ['!include scalaruri', '!var scalaruri'])
        .then((result) => {
          assert.equal(result.length, 0);
        })
        .then(done, done);
    });
  });

  describe('Scalar tags are not affected by scalaruri transformation', () => {
    it('regular scalar tag is not transformed to URI format', (done) => {
      schemaProvider.addSchema(SCHEMA_ID, {
        type: 'object',
        properties: {
          ref: {
            type: 'string',
          },
        },
      });
      const content = 'ref: !Ref some_value';
      parseSetup(content, ['!Ref scalar'])
        .then((result) => {
          assert.equal(result.length, 0);
        })
        .then(done, done);
    });

    it('regular scalar tag does not match scalaruri pattern', (done) => {
      schemaProvider.addSchema(SCHEMA_ID, {
        type: 'object',
        properties: {
          ref: {
            type: 'string',
            pattern: '^tag\\+Ref://.+$',
          },
        },
      });
      const content = 'ref: !Ref some_value';
      parseSetup(content, ['!Ref scalar'])
        .then((result) => {
          assert.ok(result.length > 0, 'Regular scalar tag should not be transformed to tag+ URI format');
        })
        .then(done, done);
    });
  });

  describe('Edge cases', () => {
    it('scalaruri tag in nested structure', (done) => {
      schemaProvider.addSchema(SCHEMA_ID, {
        type: 'object',
        properties: {
          script: {
            type: 'object',
            properties: {
              template: {
                type: 'string',
                pattern: '^tag\\+include://.+\\.(yaml|yml)$',
              },
            },
          },
        },
      });
      const content = 'script:\n  template: !include report.yaml';
      parseSetup(content, ['!include scalaruri'])
        .then((result) => {
          assert.equal(result.length, 0);
        })
        .then(done, done);
    });

    it('scalaruri tag with path containing subdirectories', (done) => {
      schemaProvider.addSchema(SCHEMA_ID, {
        type: 'object',
        properties: {
          template: {
            type: 'string',
            pattern: '^tag\\+include://.+\\.(yaml|yml)$',
          },
        },
      });
      const content = 'template: !include path/to/deep/file.yaml';
      parseSetup(content, ['!include scalaruri'])
        .then((result) => {
          assert.equal(result.length, 0);
        })
        .then(done, done);
    });

    it('empty custom tags list produces no transformation errors', (done) => {
      const content = 'key: some_value';
      parseSetup(content, [])
        .then((result) => {
          assert.equal(result.length, 0);
        })
        .then(done, done);
    });

    it('document with no custom tags is unaffected', (done) => {
      schemaProvider.addSchema(SCHEMA_ID, {
        type: 'object',
        properties: {
          name: { type: 'string' },
          count: { type: 'number' },
        },
      });
      const content = 'name: hello\ncount: 42';
      parseSetup(content, ['!include scalaruri'])
        .then((result) => {
          assert.equal(result.length, 0);
        })
        .then(done, done);
    });

    it('multiple scalaruri tags in same document', (done) => {
      schemaProvider.addSchema(SCHEMA_ID, {
        type: 'object',
        properties: {
          template: {
            type: 'string',
            pattern: '^tag\\+include://.+\\.(yaml|yml)$',
          },
          config: {
            type: 'string',
            pattern: '^tag\\+include://.+\\.(yaml|yml)$',
          },
          path: {
            type: 'string',
            pattern: '^tag\\+var://.+$',
          },
        },
      });
      const content = 'template: !include report.yaml\nconfig: !include settings.yml\npath: !var output_dir';
      parseSetup(content, ['!include scalaruri', '!var scalaruri'])
        .then((result) => {
          assert.equal(result.length, 0);
        })
        .then(done, done);
    });

    it('similar tag names do not interfere (e.g. !inc vs !include)', (done) => {
      schemaProvider.addSchema(SCHEMA_ID, {
        type: 'object',
        properties: {
          full: {
            type: 'string',
            pattern: '^tag\\+include://.+$',
          },
          short: {
            type: 'string',
            pattern: '^tag\\+inc://.+$',
          },
        },
      });
      const content = 'full: !include file.yaml\nshort: !inc other.yaml';
      parseSetup(content, ['!include scalaruri', '!inc scalaruri'])
        .then((result) => {
          assert.equal(result.length, 0);
        })
        .then(done, done);
    });
  });
});
