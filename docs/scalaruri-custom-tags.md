# ScalarURI Custom Tags

This document describes the `scalaruri` custom tag type added to this fork of the [RedHat YAML Language Server](https://github.com/redhat-developer/yaml-language-server). It enables JSON Schema validation to enforce the presence of custom YAML tags on scalar values.

## Purpose

YAML custom tags (e.g., `!include`, `!var`) are widely used to extend YAML with application-specific behavior such as file inclusion and variable substitution. However, JSON Schema-based validation has no native way to verify that these tags are present or correctly used. Without this, a user who forgets to write `!include` before a filename sees no warning in the editor -- the mistake only surfaces at runtime when the script fails.

This fork was created to close that gap. By making custom tags visible to the JSON Schema validator, the editor can catch these mistakes **as the user types**, providing immediate feedback and preventing errors before they reach execution.

The motivating use case is VCollab applications that use YAML-based scripts validated by the RedHat YAML Language Server. These scripts support splitting content across multiple files using custom tags:

```yaml
script:
  name: "My Report Script"
  variables: !include variables.yaml
```

A custom YAML reader combines included files at runtime. The language server's schema validation must also understand these tags to provide correct diagnostics during editing.

## The Problem

JSON Schema operates on data values and has no concept of YAML custom tags. The RedHat YAML Language Server handles this by stripping custom tags before validation -- so `!include variables.yaml` becomes the plain string `variables.yaml`. This prevents false errors, but it also means the schema cannot distinguish between a correctly tagged value and a plain string where the user forgot the tag.

Both of these pass validation identically, and the user receives no warning for the incorrect version:

```yaml
# Correct - tag is present
variables: !include variables.yaml

# Incorrect - tag is missing, but schema sees the same string
variables: variables.yaml
```

The user only discovers the mistake when the script fails at runtime -- potentially after a long execution cycle. This is the class of errors that `scalaruri` is designed to eliminate.

## The Solution: `scalaruri` Tag Type

This fork introduces a new custom tag type called **`scalaruri`**, in addition to the existing `scalar`, `sequence`, and `mapping` types. Tags declared with the `scalaruri` type undergo a URI transformation during validation, allowing JSON Schemas to enforce that the custom tag is present.

### How It Works

During validation only, scalar values with `scalaruri` tags are transformed into a URI-like format:

```
!include variables.yaml  -->  tag+include://variables.yaml
!var simulation_file      -->  tag+var://simulation_file
!module analysis          -->  tag+module://analysis
```

The original YAML content in the editor is never modified. The transformation is applied to an in-memory copy used exclusively by the schema validator.

This allows JSON Schemas to use `pattern` to enforce the `tag+name://` prefix, rejecting plain strings that lack the required custom tag.

### Comparison with `scalar` Type

| Behavior | `scalar` | `scalaruri` |
|---|---|---|
| Tag stripped before validation | Yes | Yes (replaced with URI prefix) |
| Schema sees | Plain string value | `tag+name://value` |
| Schema can enforce tag presence | No | Yes, via `pattern` |
| Use case | Decorative or informational tags | Tags that alter how the value is interpreted (file references, variable lookups) |

## What This Enables

With the `scalaruri` type and corresponding JSON Schema patterns in place, users benefit from:

- **Real-time error detection** -- The editor highlights missing or incorrect custom tags as the user types, the same way it highlights a wrong property type or a missing required field. For example, writing `variables: variables.yaml` instead of `variables: !include variables.yaml` immediately shows an error underline with a message like *"Expected !include \<filename.yaml\>"*.
- **Correct tag enforcement** -- The schema can require a specific tag on a property. Writing `!var file.yaml` where `!include` is expected is flagged as an error, not silently accepted.
- **Reduced runtime failures** -- Errors that would previously only surface when the script is executed are caught during editing, shortening the feedback loop and minimizing wasted time on debugging.
- **Standard JSON Schema tooling** -- All enforcement is done through standard JSON Schema `pattern` and `oneOf` constructs. No custom validator logic is needed on the schema side -- schema authors just write patterns against the `tag+name://` format.

## Configuration

To use `scalaruri`, declare your custom tags with the `scalaruri` type in `settings.json`:

```json
{
    "yaml.customTags": [
        "!include scalaruri",
        "!var scalaruri",
        "!module scalaruri",
        "!template scalaruri"
    ]
}
```

You can mix `scalaruri` with other tag types. Regular `scalar` tags retain their original behavior:

```json
{
    "yaml.customTags": [
        "!include scalaruri",
        "!var scalaruri",
        "!Ref scalar",
        "!Seq-example sequence"
    ]
}
```

## Schema Authoring

This section explains how schema authors can take advantage of the `scalaruri` transformation to enforce custom tag usage in their JSON Schemas. When a value fails pattern validation, the user sees an error underline in the editor with the `errorMessage` text (if provided) or a default pattern mismatch message.

### Basic Pattern for a `scalaruri` Tag

To validate a property that requires a custom tag (e.g., `!include`), use a `pattern` in your JSON Schema:

```json
{
    "type": "string",
    "pattern": "^tag\\+include://.+\\.(yaml|yml)$",
    "errorMessage": "Expected !include <filename.yaml> or !include <filename.yml>"
}
```

This validates strings like:
- `tag+include://path/to/file.yaml`
- `tag+include://config.yml`

While rejecting:
- `file.yaml` (missing tag)
- `tag+var://file.yaml` (wrong tag)

### Allowing Both Inline Content and Custom Tags

A common pattern is to allow either inline content (e.g., an array of objects) or a file reference via `!include`:

```json
{
    "variables": {
        "oneOf": [
            {
                "type": "array",
                "description": "Inline variable definitions",
                "items": {
                    "$ref": "variable.schema.json"
                }
            },
            {
                "type": "string",
                "pattern": "^tag\\+include://.+\\.(yaml|yml)$",
                "errorMessage": "Expected !include <filename.yaml>"
            }
        ]
    }
}
```

### Pattern for `!var` Tags

For variable references that don't point to files:

```json
{
    "type": "string",
    "pattern": "^tag\\+var://.+$",
    "errorMessage": "Expected !var <variable_name>"
}
```

### Accepting Multiple Tag Types

To accept either `!include` or `!var` on a property:

```json
{
    "type": "string",
    "pattern": "^tag\\+(include|var)://.+$"
}
```

## Transformation Examples

### Example 1: Script with File Includes

**Original YAML (in editor):**
```yaml
script:
  name: "My Report Script"
  variables: !include variables.yaml
  template: !include report-template.yaml
```

**Transformed for validation:**
```yaml
script:
  name: "My Report Script"
  variables: tag+include://variables.yaml
  template: tag+include://report-template.yaml
```

### Example 2: Mixed Tags

**Original YAML (in editor):**
```yaml
steps:
  - !include step1.yaml
  - action: save_report
    file_path: !var output_path
```

**Transformed for validation:**
```yaml
steps:
  - tag+include://step1.yaml
  - action: save_report
    file_path: tag+var://output_path
```

### Example 3: Loop with Includes

**Original YAML (in editor):**
```yaml
- for: mode_number
  in:
    iterable: range
    start: 1
    stop: 5
  do:
    - !include steps/create-result-slides-1.yaml
    - !include steps/create-result-slides-2.yaml
- action: save_report
  file_path: file_out.html
```

**Transformed for validation:**
```yaml
- for: mode_number
  in:
    iterable: range
    start: 1
    stop: 5
  do:
    - tag+include://steps/create-result-slides-1.yaml
    - tag+include://steps/create-result-slides-2.yaml
- action: save_report
  file_path: file_out.html
```

Note that `file_out.html` is not transformed because it has no custom tag.

## Implementation Details

This section is aimed at contributors and maintainers of this fork.

The implementation touches a small number of files in the language server:

### Modified Files

| File | Change |
|---|---|
| `src/languageservice/utils/arrUtils.ts` | Added `'scalaruri'` to the list of valid custom tag types |
| `src/languageservice/parser/custom-tag-provider.ts` | `scalaruri` tags resolve as scalars (string values) |
| `src/languageserver/handlers/validationHandlers.ts` | Regex-based transformation of `scalaruri` tags to `tag+name://value` format before validation |

### Transformation Mechanism

The transformation uses a regex replacement rather than AST parsing. This is a deliberate choice:

- **Preserves line/column positions** -- Diagnostic positions from the schema validator map correctly back to the original document. An AST-based approach (`parseDocument` + `toString`) can reformat whitespace and shift positions.
- **Performance** -- A single regex pass is faster than parsing and re-serializing the YAML AST on every keystroke.
- **Simplicity** -- No dependency on the `yaml` library's AST types for this step.

The regex matches `!tagname ` (with trailing whitespace) and replaces it with `tag+tagname://`, keeping the rest of the line intact.

### How Tags Are Identified

The transformation dynamically reads the `yaml.customTags` setting and filters for entries with the `scalaruri` type. There is no hardcoded list of tag names. Any tag declared as `scalaruri` in settings will be transformed.
