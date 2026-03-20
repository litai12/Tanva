// Compatibility polyfills for older enterprise browsers (e.g. legacy Edge builds).
// Some bundled dependencies call Object.hasOwn directly.
if (typeof Object.hasOwn !== 'function') {
  Object.defineProperty(Object, 'hasOwn', {
    value: (target: unknown, key: PropertyKey): boolean => {
      if (target == null) {
        throw new TypeError('Cannot convert undefined or null to object');
      }
      return Object.prototype.hasOwnProperty.call(target, key);
    },
    writable: true,
    configurable: true,
  });
}
