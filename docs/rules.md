# Rule catalog

Severity expresses the default operational importance, not proof that the SVG
is exploitable or unusable in every embedding context.

## Structure and limits

| Code | Severity | Meaning |
| --- | --- | --- |
| `FILE_TOO_LARGE` | error | Input exceeds the configured byte limit. |
| `XML_*` | error | The bounded parser found malformed or excessive XML structure. |
| `SVG_ROOT_INVALID` | error | The document does not contain exactly one top-level SVG root. |
| `AUDIT_FINDING_LIMIT` | error | Additional findings were omitted at the configured report ceiling. |
| `DOCTYPE_DECLARATION` | warning | A DOCTYPE is present even though the auditor never resolves it. |

## Accessibility

| Code | Severity | Meaning |
| --- | --- | --- |
| `ACCESSIBLE_NAME_MISSING` | warning | A non-decorative SVG has no title or ARIA name. |
| `TITLE_EMPTY` | warning | The direct title element is empty. |
| `DESCRIPTION_MISSING` | warning | A non-decorative SVG has no direct description. |
| `DESCRIPTION_EMPTY` | warning | The direct description element is empty. |
| `ARIA_REFERENCE_BROKEN` | error | `aria-labelledby` names an ID that does not exist. |
| `TITLE_NOT_EXPLICITLY_LABELLED` | info | `role="img"` relies on an implicit title association. |

## Canvas and layout

| Code | Severity | Meaning |
| --- | --- | --- |
| `VIEWBOX_INVALID` | error | `viewBox` is missing, malformed, or non-positive. |
| `DIMENSIONS_INCOMPLETE` | warning | Only width or height is present. |
| `DIMENSION_NON_POSITIVE` | error | A numeric width or height is not positive. |
| `ASPECT_RATIO_MISMATCH` | warning | Dimensions and viewBox have different ratios while aspect ratio is preserved. |
| `TEXT_MAY_OVERFLOW_VIEWBOX` | warning | Estimated text bounds extend materially beyond the canvas. |
| `TEXT_MAY_OVERFLOW_CONTAINER` | warning | Estimated text bounds extend materially beyond a marked card or box. |

## IDs and references

| Code | Severity | Meaning |
| --- | --- | --- |
| `ID_DUPLICATE` | error | More than one element uses the same ID. |
| `FRAGMENT_REFERENCE_BROKEN` | error | A resource references a missing local fragment. |
| `REMOTE_RESOURCE_REFERENCE` | warning | An image, use, or filter image loads a remote resource. |
| `NON_PORTABLE_RESOURCE_REFERENCE` | warning | A resource uses an absolute local path or unsupported scheme. |
| `RISKY_DATA_REFERENCE` | warning | A data URL is not a common embedded raster image. |
| `URL_CONTROL_CHARACTER` | error | URL control characters can alter downstream parsing. |

## Active content

| Code | Severity | Meaning |
| --- | --- | --- |
| `SCRIPT_ELEMENT` | error | The SVG contains a script element. |
| `EVENT_HANDLER_ATTRIBUTE` | error | An inline event-handler attribute can execute script. |
| `SCRIPTABLE_REFERENCE` | error | A resource uses a `javascript:` URL. |
| `SCRIPTABLE_BASE_REFERENCE` | error | An `xml:base` value uses a `javascript:` URL. |
| `SCRIPTABLE_STYLE_REFERENCE` | error | An inline SVG style uses a `javascript:` URL. |
| `FOREIGN_OBJECT` | warning | Embedded non-SVG content needs separate review. |
| `CSS_IMPORT` | warning | Embedded CSS imports another stylesheet. |
| `CSS_REMOTE_RESOURCE` | warning | Embedded CSS loads a remote resource. |
| `EXTERNAL_STYLESHEET_INSTRUCTION` | warning | An XML processing instruction may load external CSS. |

The auditor reports facts about the file. It is not an SVG sanitizer and does
not promise that a file with zero findings is safe in every HTML, CSS, image,
or document rendering context.
