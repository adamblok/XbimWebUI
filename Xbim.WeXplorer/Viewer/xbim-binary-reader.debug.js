function xBinaryReader() {
    this._buffer = null;
    this._position = 0;
}

xBinaryReader.prototype.onloaded = function () { };
xBinaryReader.prototype.onerror = function () { };

xBinaryReader.prototype.load = function (source) {
    this._position = 0;
    const self = this;

    if (typeof (source) === 'undefined' || source === null) throw 'Source must be defined';
    if (typeof (source) === 'string') {
        const xhr = new XMLHttpRequest();
        xhr.open("GET", source, true);
        xhr.onreadystatechange = function () {
            if (xhr.readyState === 4 && xhr.status === 200) {
                const fReader = new FileReader();
                fReader.onloadend = function () {
                    if (fReader.result) {
                        //set data buffer for next processing
                        self._buffer = fReader.result;
                        //do predefined processing of the data
                        if (self.onloaded) {
                            self.onloaded();
                        }
                    }
                };
                fReader.readAsArrayBuffer(xhr.response);
            }
            //throw exception as a warning
            if (xhr.readyState === 4 && xhr.status !== 200) {
                const msg = 'Failed to fetch binary data from server. Server code: ' + xhr.status + '.' +
                            'This might be due to CORS policy of your browser if you run this as a local file.';

                if (self.onerror) self.onerror(msg);
                throw msg;
            }
        };

        xhr.responseType = 'blob';
        xhr.send();
    }
    else if (source instanceof Blob || source instanceof File) {
        const fReader = new FileReader();
        fReader.onloadend = function () {
            if (fReader.result) {
                //set data buffer for next processing
                self._buffer = fReader.result;
                //do predefined processing of the data
                if (self.onloaded) {
                    self.onloaded();
                }
            }
        };
        fReader.readAsArrayBuffer(source);
    }
    else if (source instanceof ArrayBuffer) {
        this._buffer = source;
    }
};

xBinaryReader.prototype.getIsEOF = function (type, count) {
    if (typeof (this._position) === "undefined")
        throw "Position is not defined";

    return this._position === this._buffer.byteLength;
};

xBinaryReader.prototype.read = function (arity, count, ctor) {
    if (typeof (count) === "undefined") count = 1;

    const length = arity * count;
    const offset = this._position;

    this._position += length;

    return count === 1 ?
        new ctor(this._buffer.slice(offset, offset + length))[0] :
        new ctor(this._buffer.slice(offset, offset + length));
};

xBinaryReader.prototype.readByte = function (count) {
    return this.read(1, count, Uint8Array);
};

xBinaryReader.prototype.readUint8 = function (count) {
    return this.read(1, count, Uint8Array);
};

xBinaryReader.prototype.readInt16 = function (count) {
    return this.read(2, count, Int16Array);
};

xBinaryReader.prototype.readUint16 = function (count) {
    return this.read(2, count, Uint16Array);
};

xBinaryReader.prototype.readInt32 = function (count) {
    return this.read(4, count, Int32Array);
};

xBinaryReader.prototype.readUint32 = function (count) {
    return this.read(4, count, Uint32Array);
};

xBinaryReader.prototype.readFloat32 = function (count) {
    return this.read(4, count, Float32Array);
};

xBinaryReader.prototype.readFloat64 = function (count) {
    return this.read(8, count, Float64Array);
};

//functions for a higher objects like points, colours and matrices
xBinaryReader.prototype.readChar = function (count) {
    if (typeof (count) === "undefined") count = 1;

    const bytes = this.readByte(count);
    const result = new Array(count);

    for (let i in bytes) {
        // noinspection JSUnfilteredForInLoop
        result[i] = String.fromCharCode(bytes[i]);
    }

    return count === 1 ? result[0] : result;
};

xBinaryReader.prototype.readPoint = function (count) {
    if (typeof (count) === "undefined") count = 1;

    const coords = this.readFloat32(count * 3);
    const result = new Array(count);

    for (let i = 0; i < count; i++) {
        const offset = i * 3 * 4;

        //only create new view on the buffer so that no new memory is allocated
        result[i] = new Float32Array(coords.buffer, offset, 3);
    }

    return count === 1 ? result[0] : result;
};

xBinaryReader.prototype.readRgba = function (count) {
    if (typeof (count) === "undefined") count = 1;

    const values = this.readByte(count * 4);
    const result = new Array(count);

    for (let i = 0; i < count ; i++) {
        const offset = i * 4;
        result[i] = new Uint8Array(values.buffer, offset, 4);
    }

    return count === 1 ? result[0] : result;
};

xBinaryReader.prototype.readPackedNormal = function (count) {
    if (typeof (count) === "undefined") count = 1;

    const values = this.readUint8(count * 2);
    const result = new Array(count);
    for (let i = 0; i < count; i++) {
        result[i] = new Uint8Array(values.buffer, i * 2, 2);
    }
    return count === 1 ? result[0] : result;
};

xBinaryReader.prototype.readMatrix4x4 = function (count) {
    if (typeof (count) === "undefined") count = 1;

    const values = this.readFloat32(count * 16);
    const result = new Array(count);

    for (let i = 0; i < count; i++) {
        const offset = i * 16 * 4;
        result[i] = new Float32Array(values.buffer, offset, 16);
    }
    return count === 1 ? result[0] : result;
};

xBinaryReader.prototype.readMatrix4x4_64 = function (count) {
    if (typeof (count) === "undefined") count = 1;

    const values = this.readFloat64(count * 16);
    const result = new Array(count);

    for (let i = 0; i < count; i++) {
        const offset = i * 16 * 8;
        result[i] = new Float64Array(values.buffer, offset, 16);
    }
    return count === 1 ? result[0] : result;
};
