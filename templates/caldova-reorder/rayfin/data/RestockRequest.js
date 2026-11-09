var __esDecorate = (this && this.__esDecorate) || function (ctor, descriptorIn, decorators, contextIn, initializers, extraInitializers) {
    function accept(f) { if (f !== void 0 && typeof f !== "function") throw new TypeError("Function expected"); return f; }
    var kind = contextIn.kind, key = kind === "getter" ? "get" : kind === "setter" ? "set" : "value";
    var target = !descriptorIn && ctor ? contextIn["static"] ? ctor : ctor.prototype : null;
    var descriptor = descriptorIn || (target ? Object.getOwnPropertyDescriptor(target, contextIn.name) : {});
    var _, done = false;
    for (var i = decorators.length - 1; i >= 0; i--) {
        var context = {};
        for (var p in contextIn) context[p] = p === "access" ? {} : contextIn[p];
        for (var p in contextIn.access) context.access[p] = contextIn.access[p];
        context.addInitializer = function (f) { if (done) throw new TypeError("Cannot add initializers after decoration has completed"); extraInitializers.push(accept(f || null)); };
        var result = (0, decorators[i])(kind === "accessor" ? { get: descriptor.get, set: descriptor.set } : descriptor[key], context);
        if (kind === "accessor") {
            if (result === void 0) continue;
            if (result === null || typeof result !== "object") throw new TypeError("Object expected");
            if (_ = accept(result.get)) descriptor.get = _;
            if (_ = accept(result.set)) descriptor.set = _;
            if (_ = accept(result.init)) initializers.unshift(_);
        }
        else if (_ = accept(result)) {
            if (kind === "field") initializers.unshift(_);
            else descriptor[key] = _;
        }
    }
    if (target) Object.defineProperty(target, contextIn.name, descriptor);
    done = true;
};
var __runInitializers = (this && this.__runInitializers) || function (thisArg, initializers, value) {
    var useValue = arguments.length > 2;
    for (var i = 0; i < initializers.length; i++) {
        value = useValue ? initializers[i].call(thisArg, value) : initializers[i].call(thisArg);
    }
    return useValue ? value : void 0;
};
import { entity, role, uuid, text, int, date, set } from '@microsoft/rayfin-core';
/**
 * A reorder a regional manager sent to purchasing.
 *
 * Caldova's semantic model reads this table, so a request a manager sends here
 * shows up in the app, the regional dashboard and analytics as one number.
 * `requested_by` and `requested_at` are what make a request traceable.
 */
let RestockRequest = (() => {
    let _classDecorators = [entity(), role('authenticated', ['create', 'read'], {
            check: (claims, item) => claims.sub.eq(item.requested_by_id),
        })];
    let _classDescriptor;
    let _classExtraInitializers = [];
    let _classThis;
    let _id_decorators;
    let _id_initializers = [];
    let _id_extraInitializers = [];
    let _store_id_decorators;
    let _store_id_initializers = [];
    let _store_id_extraInitializers = [];
    let _sku_decorators;
    let _sku_initializers = [];
    let _sku_extraInitializers = [];
    let _qty_decorators;
    let _qty_initializers = [];
    let _qty_extraInitializers = [];
    let _requested_by_decorators;
    let _requested_by_initializers = [];
    let _requested_by_extraInitializers = [];
    let _requested_by_id_decorators;
    let _requested_by_id_initializers = [];
    let _requested_by_id_extraInitializers = [];
    let _requested_at_decorators;
    let _requested_at_initializers = [];
    let _requested_at_extraInitializers = [];
    let _status_decorators;
    let _status_initializers = [];
    let _status_extraInitializers = [];
    let _note_decorators;
    let _note_initializers = [];
    let _note_extraInitializers = [];
    var RestockRequest = class {
        static { _classThis = this; }
        static {
            const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(null) : void 0;
            _id_decorators = [uuid()];
            _store_id_decorators = [text({ max: 32 })];
            _sku_decorators = [text({ max: 32 })];
            _qty_decorators = [int()];
            _requested_by_decorators = [text({ max: 200 })];
            _requested_by_id_decorators = [text({ max: 64 })];
            _requested_at_decorators = [date()];
            _status_decorators = [set('submitted', 'fulfilled')];
            _note_decorators = [text({ max: 400, optional: true })];
            __esDecorate(null, null, _id_decorators, { kind: "field", name: "id", static: false, private: false, access: { has: obj => "id" in obj, get: obj => obj.id, set: (obj, value) => { obj.id = value; } }, metadata: _metadata }, _id_initializers, _id_extraInitializers);
            __esDecorate(null, null, _store_id_decorators, { kind: "field", name: "store_id", static: false, private: false, access: { has: obj => "store_id" in obj, get: obj => obj.store_id, set: (obj, value) => { obj.store_id = value; } }, metadata: _metadata }, _store_id_initializers, _store_id_extraInitializers);
            __esDecorate(null, null, _sku_decorators, { kind: "field", name: "sku", static: false, private: false, access: { has: obj => "sku" in obj, get: obj => obj.sku, set: (obj, value) => { obj.sku = value; } }, metadata: _metadata }, _sku_initializers, _sku_extraInitializers);
            __esDecorate(null, null, _qty_decorators, { kind: "field", name: "qty", static: false, private: false, access: { has: obj => "qty" in obj, get: obj => obj.qty, set: (obj, value) => { obj.qty = value; } }, metadata: _metadata }, _qty_initializers, _qty_extraInitializers);
            __esDecorate(null, null, _requested_by_decorators, { kind: "field", name: "requested_by", static: false, private: false, access: { has: obj => "requested_by" in obj, get: obj => obj.requested_by, set: (obj, value) => { obj.requested_by = value; } }, metadata: _metadata }, _requested_by_initializers, _requested_by_extraInitializers);
            __esDecorate(null, null, _requested_by_id_decorators, { kind: "field", name: "requested_by_id", static: false, private: false, access: { has: obj => "requested_by_id" in obj, get: obj => obj.requested_by_id, set: (obj, value) => { obj.requested_by_id = value; } }, metadata: _metadata }, _requested_by_id_initializers, _requested_by_id_extraInitializers);
            __esDecorate(null, null, _requested_at_decorators, { kind: "field", name: "requested_at", static: false, private: false, access: { has: obj => "requested_at" in obj, get: obj => obj.requested_at, set: (obj, value) => { obj.requested_at = value; } }, metadata: _metadata }, _requested_at_initializers, _requested_at_extraInitializers);
            __esDecorate(null, null, _status_decorators, { kind: "field", name: "status", static: false, private: false, access: { has: obj => "status" in obj, get: obj => obj.status, set: (obj, value) => { obj.status = value; } }, metadata: _metadata }, _status_initializers, _status_extraInitializers);
            __esDecorate(null, null, _note_decorators, { kind: "field", name: "note", static: false, private: false, access: { has: obj => "note" in obj, get: obj => obj.note, set: (obj, value) => { obj.note = value; } }, metadata: _metadata }, _note_initializers, _note_extraInitializers);
            __esDecorate(null, _classDescriptor = { value: _classThis }, _classDecorators, { kind: "class", name: _classThis.name, metadata: _metadata }, null, _classExtraInitializers);
            RestockRequest = _classThis = _classDescriptor.value;
            if (_metadata) Object.defineProperty(_classThis, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
            __runInitializers(_classThis, _classExtraInitializers);
        }
        id = __runInitializers(this, _id_initializers, void 0);
        store_id = (__runInitializers(this, _id_extraInitializers), __runInitializers(this, _store_id_initializers, void 0));
        sku = (__runInitializers(this, _store_id_extraInitializers), __runInitializers(this, _sku_initializers, void 0));
        qty = (__runInitializers(this, _sku_extraInitializers), __runInitializers(this, _qty_initializers, void 0));
        /** Who asked for the restock, as the signed-in user. */
        requested_by = (__runInitializers(this, _qty_extraInitializers), __runInitializers(this, _requested_by_initializers, void 0));
        /** The requester's directory object id, so the request traces to an identity. */
        requested_by_id = (__runInitializers(this, _requested_by_extraInitializers), __runInitializers(this, _requested_by_id_initializers, void 0));
        /** When the request was made, in UTC. */
        requested_at = (__runInitializers(this, _requested_by_id_extraInitializers), __runInitializers(this, _requested_at_initializers, void 0));
        status = (__runInitializers(this, _requested_at_extraInitializers), __runInitializers(this, _status_initializers, void 0));
        note = (__runInitializers(this, _status_extraInitializers), __runInitializers(this, _note_initializers, void 0));
        constructor() {
            __runInitializers(this, _note_extraInitializers);
        }
    };
    return RestockRequest = _classThis;
})();
export { RestockRequest };
//# sourceMappingURL=RestockRequest.js.map