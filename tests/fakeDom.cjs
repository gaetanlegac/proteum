/*
 * The smallest document Preact's `render` needs to mount and update a tree in Node: element and text nodes,
 * child lists, attributes. No layout, no events: a test that clicks drives the component's handlers itself.
 */

class FakeNode {
    constructor(nodeType) {
        this.nodeType = nodeType;
        this.parentNode = null;
        this.childNodes = [];
    }

    get firstChild() {
        return this.childNodes[0] || null;
    }

    get nextSibling() {
        if (!this.parentNode) return null;
        const siblings = this.parentNode.childNodes;
        return siblings[siblings.indexOf(this) + 1] || null;
    }

    insertBefore(node, reference) {
        if (node.parentNode) node.parentNode.removeChild(node);
        const index = reference ? this.childNodes.indexOf(reference) : -1;
        if (index < 0) this.childNodes.push(node);
        else this.childNodes.splice(index, 0, node);
        node.parentNode = this;
        return node;
    }

    appendChild(node) {
        return this.insertBefore(node, null);
    }

    removeChild(node) {
        this.childNodes.splice(this.childNodes.indexOf(node), 1);
        node.parentNode = null;
        return node;
    }

    get textContent() {
        return this.childNodes.map((child) => child.textContent).join('');
    }
}

class FakeText extends FakeNode {
    constructor(data) {
        super(3);
        this.data = String(data);
    }

    get textContent() {
        return this.data;
    }
}

class FakeElement extends FakeNode {
    constructor(localName, namespaceURI) {
        super(1);
        this.localName = localName;
        this.namespaceURI = namespaceURI;
        this.attributes = {};
        this.style = {};
    }

    setAttribute(name, value) {
        this.attributes[name] = String(value);
    }

    removeAttribute(name) {
        delete this.attributes[name];
    }

    getAttribute(name) {
        return name in this.attributes ? this.attributes[name] : null;
    }

    addEventListener() {}

    removeEventListener() {}
}

const createFakeDocument = () => ({
    createElement: (name) => new FakeElement(name, 'http://www.w3.org/1999/xhtml'),
    createElementNS: (namespace, name) => new FakeElement(name, namespace),
    createTextNode: (data) => new FakeText(data),
});

module.exports = { createFakeDocument };
