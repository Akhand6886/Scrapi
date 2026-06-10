import { File } from 'buffer';

if (typeof globalThis.File === 'undefined') {
  globalThis.File = File;
}
