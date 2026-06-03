import fs from "node:fs";
import path from "node:path";

type WasmBindgenExports = WebAssembly.Exports & {
  __wbindgen_add_to_stack_pointer: (value: number) => number;
  __wbindgen_malloc: (size: number, align: number) => number;
  __wbindgen_realloc: (
    ptr: number,
    oldSize: number,
    newSize: number,
    align: number,
  ) => number;
  __wbindgen_free: (ptr: number, size: number, align: number) => void;
  process: (retPtr: number, ptr: number, len: number) => void;
  memory: WebAssembly.Memory;
};

type WasmRuntime = {
  process: (input: string) => string;
};

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8", { ignoreBOM: true, fatal: true });

let wasmPromise: Promise<WasmRuntime> | null = null;

function readWasmArtifact() {
  const wasmPath = path.join(process.cwd(), "wasm/ingress_engine_bg.wasm");
  return fs.readFileSync(wasmPath);
}

function createProcessBinding(wasm: WasmBindgenExports): WasmRuntime["process"] {
  let vectorLength = 0;
  let cachedUint8Memory: Uint8Array | null = null;
  let cachedInt32Memory: Int32Array | null = null;

  function getUint8Memory() {
    if (cachedUint8Memory === null || cachedUint8Memory.byteLength === 0) {
      cachedUint8Memory = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8Memory;
  }

  function getInt32Memory() {
    if (cachedInt32Memory === null || cachedInt32Memory.byteLength === 0) {
      cachedInt32Memory = new Int32Array(wasm.memory.buffer);
    }
    return cachedInt32Memory;
  }

  function passStringToWasm(value: string) {
    if (value.length === 0) {
      vectorLength = 0;
      return 0;
    }

    let offset = 0;
    let pointer = wasm.__wbindgen_malloc(value.length, 1);
    const memory = getUint8Memory();

    for (; offset < value.length; offset += 1) {
      const code = value.charCodeAt(offset);
      if (code > 0x7f) {
        break;
      }
      memory[pointer + offset] = code;
    }

    if (offset !== value.length) {
      const remainder = value.slice(offset);
      pointer = wasm.__wbindgen_realloc(pointer, value.length, offset + remainder.length * 3, 1);
      const view = getUint8Memory().subarray(pointer + offset, pointer + offset + remainder.length * 3);
      const encoded = textEncoder.encodeInto(remainder, view);
      offset += encoded.written ?? 0;
    }

    vectorLength = offset;
    return pointer;
  }

  function readString(pointer: number, length: number) {
    return textDecoder.decode(getUint8Memory().subarray(pointer, pointer + length));
  }

  return (input: string) => {
    const retPointer = wasm.__wbindgen_add_to_stack_pointer(-16);
    try {
      const inputPointer = passStringToWasm(input);
      const inputLength = vectorLength;
      wasm.process(retPointer, inputPointer, inputLength);

      const memory = getInt32Memory();
      const resultPointer = memory[retPointer / 4];
      const resultLength = memory[retPointer / 4 + 1];
      const output = readString(resultPointer, resultLength);
      wasm.__wbindgen_free(resultPointer, resultLength, 1);
      return output;
    } finally {
      wasm.__wbindgen_add_to_stack_pointer(16);
    }
  };
}

export async function loadWasm(): Promise<WasmRuntime> {
  if (!wasmPromise) {
    wasmPromise = WebAssembly.instantiate(readWasmArtifact(), {})
      .then(({ instance }) => {
        const exports = instance.exports as WasmBindgenExports;
        return { process: createProcessBinding(exports) };
      })
      .catch((error: unknown) => {
        wasmPromise = null;
        throw error;
      });
  }
  return await wasmPromise;
}
