# Browser Preference Switcher

This context defines the product language for automatically selecting a browser identity on sites where it improves compatibility.

## Language

**Reported browser identity**:
The browser identity a matched site receives through request headers. The extension does not change JavaScript-visible browser properties or the browser's rendering engine.

**Automatic site rule**:
A domain-specific mapping to a reported browser identity, included when the site's preference is documented, a compatibility benefit has been verified, or the user has explicitly requested that mapping.

**Reported platform**:
The operating system presented as part of a reported browser identity. The default is the user's actual operating system, and the user can choose another platform.
