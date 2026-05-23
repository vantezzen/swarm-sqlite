declare namespace Asyncify {
  function handleAsync(f: () => Promise<any>);
}

declare function UTF8ToString(ptr: number): string;
declare function lengthBytesUTF8(s: string): number;
declare function stringToUTF8(s: string, p: number, n: number);
declare function ccall(name: string, returns: string, args: Array<any>, options?: object): any;
declare function getValue(ptr: number, type: string): number;
declare function setValue(ptr: number, value: number, type: string): number;
declare function mergeInto(library: object, methods: object): void;

declare let HEAPU8: Uint8Array;
declare let HEAP32: Int32Array;
declare let LibraryManager;
declare let Module;
declare let _vfsAccess;
declare let _vfsCheckReservedLock;
declare let _vfsClose;
declare let _vfsDelete;
declare let _vfsDeviceCharacteristics;
declare let _vfsFileControl;
declare let _vfsFileSize;
declare let _vfsLock;
declare let _vfsOpen;
declare let _vfsRead;
declare let _vfsSectorSize;
declare let _vfsSync;
declare let _vfsTruncate;
declare let _vfsUnlock;
declare let _vfsWrite;

declare let _jsFunc;
declare let _jsStep;
declare let _jsFinal;

declare let _modStruct;
declare let _modCreate;
declare let _modConnect;
declare let _modBestIndex;
declare let _modDisconnect;
declare let _modDestroy;
declare let _modOpen;
declare let _modClose;
declare let _modFilter;
declare let _modNext;
declare let _modEof;
declare let _modColumn;
declare let _modRowid;
declare let _modUpdate;
declare let _modBegin;
declare let _modSync;
declare let _modCommit;
declare let _modRollback;
declare let _modFindFunction;
declare let _modRename;

declare let _jsAuth;

declare let _jsProgress;