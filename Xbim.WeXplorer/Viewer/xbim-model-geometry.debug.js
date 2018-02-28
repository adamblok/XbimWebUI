function xModelGeometry() {
    //all this data is to be fed into GPU as attributes
    this.normals = [];
    this.indices = [];
    this.products = [];
    this.transformations = [];
    this.styleIndices = [];
    this.states = []; //this is the only array we need to keep alive on client side to be able to change appearance of the model

    //these will be sent to GPU as the textures
    this.vertices = [];
    this.matrices = [];
    this.styles = [];

    this.meter = 1000;

    //this will be used to change appearance of the objects
    //map objects have a format:
    //map = {
    //	productID: int,
    //	type: int,
    //	bBox: Float32Array(6),
    //	spans: [Int32Array([int, int]),Int32Array([int, int]), ...] //spanning indexes defining shapes of product and it's state
    //};

    this.productMap = {};
}

/**
 * Static counter to keep unique ID of the model handles
 */
xModelGeometry._instancesNum = 0;

/**
 * Container for information about appended models
 */
xModelGeometry._appendedModels = [];

/**
 * Container which keeps product ids
 */
xModelGeometry._productIds = [];

xModelGeometry.prototype.findFreeProductId = function (productId) {
    while (xModelGeometry._productIds.indexOf(productId) !== -1) {
        productId += Math.round(Math.random() * 10).toString();
        productId = parseInt(productId);
    }

    return productId;
};

xModelGeometry.prototype.getProductIdForAppendedModel = function (appendedModel, productId) {
    return appendedModel.productIdsMap[productId];
};

xModelGeometry.prototype.parse = function (binReader) {
    const br = binReader;
    const magicNumber = br.readInt32();
    if (magicNumber !== 94132117) throw 'Magic number mismatch.';

    const version = br.readByte();
    const numShapes = br.readInt32();
    const numVertices = br.readInt32();
    const numTriangles = br.readInt32();
    const numMatrices = br.readInt32();
    const numProducts = br.readInt32();
    const numStyles = br.readInt32();
    this.meter = br.readFloat32();
    const numRegions = br.readInt16();

    //set size of arrays to be square usable for texture data
    //TODO: reflect support for floating point textures
    const square = function (arity, count) {
        if (typeof (arity) === 'undefined' || typeof (count) === 'undefined') {
            throw 'Wrong arguments';
        }

        if (count === 0) return 0;

        const byteLength = count * arity;
        let imgSide = Math.ceil(Math.sqrt(byteLength / 4));

        //clamp to parity
        while ((imgSide * 4) % arity !== 0) {
            imgSide++
        }

        return imgSide * imgSide * 4 / arity;
    };

    //create target buffers of correct size (avoid reallocation of memory)
    this.vertices = new Float32Array(square(4, numVertices * 3));
    this.normals = new Uint8Array(numTriangles * 6);
    this.indices = new Float32Array(numTriangles * 3);
    this.styleIndices = new Uint16Array(numTriangles * 3);
    this.styles = new Uint8Array(square(1, (numStyles + 1) * 4)); //+1 is for a default style
    this.products = new Float32Array(numTriangles * 3);
    this.states = new Uint8Array(numTriangles * 3 * 2); //place for state and restyling
    this.transformations = new Float32Array(numTriangles * 3);
    this.matrices = new Float32Array(square(4, numMatrices * 16));
    this.productMap = {};
    this.regions = new Array(numRegions);
    this.area = {
        x: [],
        y: [],
        z: []
    };

    let iVertex = 0;
    let iIndexForward = 0;
    let iIndexBackward = numTriangles * 3;
    let iTransform = 0;
    let iMatrix = 0;

    const stateEnum = xState;
    const typeEnum = xProductType;

    for (let i = 0; i < numRegions; i++) {
        this.regions[i] = {
            population: br.readInt32(),
            centre: br.readFloat32(3),
            bbox: br.readFloat32(6)
        }
    }

    const styleMap = [];
    styleMap.getStyle = function(id) {
        for (let i = 0; i < this.length; i++) {
            const item = this[i];
            if (item.id === id) return item;
        }
        return null;
    };

    let iStyle = 0;
    for (iStyle; iStyle < numStyles; iStyle++) {
        const styleId = br.readInt32();
        const R = br.readFloat32() * 255;
        const G = br.readFloat32() * 255;
        const B = br.readFloat32() * 255;
        const A = br.readFloat32() * 255;

        this.styles.set([R, G, B, A], iStyle * 4);
        styleMap.push({ id: styleId, index: iStyle, transparent: A < 254 });
    }

    this.styles.set([255, 255, 255, 255], iStyle * 4);

    const defaultStyle = { id: -1, index: iStyle, transparent: 255 };
    styleMap.push(defaultStyle);

    // check if model is appended
    const modelId = this.id;
    const appendedModel = xModelGeometry._appendedModels[modelId];

    for (let i = 0; i < numProducts ; i++) {
        let productLabel = br.readInt32();

        if (appendedModel) {
            appendedModel.productIdsMap[productLabel] = this.findFreeProductId(productLabel);
            productLabel = this.getProductIdForAppendedModel(appendedModel, productLabel);
        }

        const prodType = br.readInt16();
        const bBox = br.readFloat32(6);

        this.productMap[productLabel] = {
            productID: productLabel,
            type: prodType,
            bBox: bBox,
            spans: []
        };

        xModelGeometry._productIds.push(productLabel);
    }

    for (let iShape = 0; iShape < numShapes; iShape++) {
        const repetition = br.readInt32();
        const shapeList = [];

        for (let iProduct = 0; iProduct < repetition; iProduct++) {
            let prodLabel = br.readInt32();

            if (appendedModel) {
                prodLabel = this.getProductIdForAppendedModel(appendedModel, prodLabel);
            }

            const instanceTypeId = br.readInt16();
            const instanceLabel = br.readInt32();
            const styleId = br.readInt32();
            let transformation = null;

            if (repetition > 1) {
                transformation = version === 1 ? br.readFloat32(16) : br.readFloat64(16);
                this.matrices.set(transformation, iMatrix);
                iMatrix += 16;
            }

            let styleItem = styleMap.getStyle(styleId);
            if (styleItem === null)
                styleItem = defaultStyle;

            shapeList.push({
                pLabel: prodLabel,
                iLabel: instanceLabel,
                style: styleItem.index,
                transparent: styleItem.transparent,
                transform: transformation != null ? iTransform++ : 0xFFFF
            });
        }

        //read shape geometry
        let shapeGeom = new xTriangulatedShape();
        shapeGeom.parse(br);

        //copy shape data into inner array and set to null so it can be garbage collected
        shapeList.forEach(function (shape) {
            let iIndex = 0;
            //set iIndex according to transparency either from beginning or at the end
            if (shape.transparent) {
                iIndex = iIndexBackward - shapeGeom.indices.length;
            }
            else {
                iIndex = iIndexForward;
            }

            const begin = iIndex;
            let map = this.productMap[shape.pLabel];
            if (typeof (map) === "undefined") {
                //throw "Product hasn't been defined before.";
                map = {
                    productID: 0,
                    type: typeEnum.IFCOPENINGELEMENT,
                    bBox: new Float32Array(6),
                    spans: []
                };
                this.productMap[shape.pLabel] = map;
            }

            this.normals.set(shapeGeom.normals, iIndex * 2);

            //switch spaces and openings off by default
            const state = map.type === typeEnum.IFCSPACE || map.type === typeEnum.IFCOPENINGELEMENT ?
                  stateEnum.HIDDEN :
                  0xFF; //0xFF is for the default state

            //fix indices to right absolute position. It is relative to the shape.
            for (let i = 0; i < shapeGeom.indices.length; i++) {
                this.indices[iIndex] = shapeGeom.indices[i] + iVertex / 3;
                this.products[iIndex] = shape.pLabel;
                this.styleIndices[iIndex] = shape.style;
                this.transformations[iIndex] = shape.transform;
                this.states[2 * iIndex] = state; //set state
                this.states[2 * iIndex + 1] = 0xFF; //default style

                iIndex++;
            }

            const end = iIndex;
            map.spans.push(new Int32Array([begin, end]));

            if (shape.transparent) iIndexBackward -= shapeGeom.indices.length;
            else iIndexForward += shapeGeom.indices.length;
        }, this);

        // get area data
        let j = 0, axis, vertex;

        for (let i in shapeGeom.vertices) {
            if (!shapeGeom.vertices.hasOwnProperty(i)) {
                continue;
            }

            vertex = shapeGeom.vertices[i];

            if (j > 2) {
                j = 0;
            }

            switch (j) {
                case 0: axis = 'x'; break;
                case 1: axis = 'y'; break;
                case 2: axis = 'z'; break;
            }

            if (appendedModel) {
                if (appendedModel.options.scale) {
                    shapeGeom.vertices[i] *= appendedModel.options.scale;
                }

                switch (axis) {
                    case 'x': shapeGeom.vertices[i] += appendedModel.options.x; break;
                    case 'y': shapeGeom.vertices[i] += appendedModel.options.y; break;
                    case 'z': shapeGeom.vertices[i] += appendedModel.options.z; break;
                }
            }

            if (this.area[axis][0] === undefined || vertex < this.area[axis][0]) {
                this.area[axis][0] = vertex;
            }

            if (this.area[axis][1] === undefined || vertex > this.area[axis][1]) {
                this.area[axis][1] = vertex;
            }

            j++;
        }

        //copy geometry and keep track of amount so that we can fix indices to right position
        //this must be the last step to have correct iVertex number above
        this.vertices.set(shapeGeom.vertices, iVertex);
        iVertex += shapeGeom.vertices.length;
        shapeGeom = null;
    }

    //binary reader should be at the end by now
    if (!br.getIsEOF()) {
        //throw 'Binary reader is not at the end of the file.';
    }

    this.transparentIndex = iIndexForward;
};

//Source has to be either URL of wexBIM file or Blob representing wexBIM file
xModelGeometry.prototype.load = function (source) {
    //binary reading
    const br = new xBinaryReader();
    const self = this;
    br.onloaded = function () {
        self.parse(br);
        if (self.onloaded) {
            self.onloaded();
        }
    };
    br.onerror = function (msg) {
        if (self.onerror) self.onerror(msg);
    };
    br.load(source);
};

xModelGeometry.prototype.onloaded = function () { };
xModelGeometry.prototype.onerror = function () { };
