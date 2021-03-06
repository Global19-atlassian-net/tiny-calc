/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */

import {
    ITreeShapeProducer,
    ITreeShapeConsumer,
    ITreeShapeReader,
    TreeNode,
    TreeNodeHandle,
    TreeNodeLocation,
    ITreeShapeWriter,
} from "./types";
import {
    FrugalList,
    FrugalList_push,
    FrugalList_removeFirst,
    FrugalList_forEach
} from "@tiny-calc/frugallist";
import { HandleTable } from "@tiny-calc/handletable";

const enum ShapeFieldOffset {
    parent = 0,
    firstChild = 1,
    nextSibling = 2,
    lastChild = 3,
    prevSibling = 4,
    fieldCount = 5,
}

const enum TreeNodeIndex {
    none = TreeNodeHandle.none * ShapeFieldOffset.fieldCount,
}

function toIndex(node: TreeNode): TreeNodeIndex { return node * ShapeFieldOffset.fieldCount; }
function toNode(index: TreeNodeIndex): TreeNode { return index / ShapeFieldOffset.fieldCount as TreeNode; }

export class TreeShape implements ITreeShapeProducer, ITreeShapeReader, ITreeShapeWriter {
    private readonly shape: TreeNodeIndex[] = [
        /* root: */ TreeNodeIndex.none, TreeNodeIndex.none, TreeNodeIndex.none, TreeNodeIndex.none, TreeNodeIndex.none,
    ];

    private consumers: FrugalList<ITreeShapeConsumer>;
    private readonly handles = new HandleTable<void, TreeNode>();

    // #region ITreeShapeProducer

    public openTree(consumer: ITreeShapeConsumer): ITreeShapeReader {
        this.consumers = FrugalList_push(this.consumers, consumer);
        return this;
    }

    public closeTree(consumer: ITreeShapeConsumer): void {
        this.consumers = FrugalList_removeFirst(this.consumers, consumer);
    }

    public createNode(): TreeNode {
        const node = this.handles.add(undefined);
        const index = toIndex(node);

        this.setParentIndex(index, TreeNodeIndex.none);
        this.setFirstChildIndex(index, TreeNodeIndex.none);
        this.setNextSiblingIndex(index, TreeNodeIndex.none);
        this.setLastChildIndex(index, TreeNodeIndex.none);
        this.setPrevSiblingIndex(index, TreeNodeIndex.none);
        return node;
    }

    public deleteNode(node: TreeNode): void {
        this.removeNode(node);
        this.handles.delete(node);
    }

    // #endregion ITreeShapeProducer

    // #region ITreeShapeReader

    public getParent(node: TreeNode): TreeNode      { return toNode(this.getParentIndex(toIndex(node))); }
    public getFirstChild(node: TreeNode): TreeNode  { return toNode(this.getFirstChildIndex(toIndex(node))); }
    public getLastChild(node: TreeNode): TreeNode   { return toNode(this.getLastChildIndex(toIndex(node))); }
    public getNextSibling(node: TreeNode): TreeNode { return toNode(this.getNextSiblingIndex(toIndex(node))); }
    public getPrevSibling(node: TreeNode): TreeNode { return toNode(this.getPrevSiblingIndex(toIndex(node))); }

    public beforeNode(node: TreeNode): TreeNodeLocation {
        const prev = this.getPrevSibling(node);

        return prev === TreeNodeHandle.none
            ? this.firstChildOf(this.getParent(node))
            : this.afterNode(prev);
    }

    public afterNode(node: TreeNode): TreeNodeLocation {
        return node as unknown as TreeNodeLocation;
    }

    public firstChildOf(parent: TreeNode): TreeNodeLocation {
        return -parent as TreeNodeLocation;
    }

    public lastChildOf(parent: TreeNode): TreeNodeLocation {
        const oldLast = this.getLastChild(parent);
        return oldLast === TreeNodeHandle.none
            ? this.firstChildOf(parent)
            : oldLast as unknown as TreeNodeLocation;
    }

    public parentOfLocation(location: TreeNodeLocation): TreeNode {
        // If 'location' refers to the position before a node that is the first child
        return location > 0
            ? this.getParent(location as unknown as TreeNode)
            : -location as TreeNode;
    }

    // #endregion ITreeShapeReader

    private getParentIndex(node: TreeNodeIndex): TreeNodeIndex      { return this.shape[node + ShapeFieldOffset.parent]; }
    private getFirstChildIndex(node: TreeNodeIndex): TreeNodeIndex  { return this.shape[node + ShapeFieldOffset.firstChild]; }
    private getLastChildIndex(node: TreeNodeIndex): TreeNodeIndex   { return this.shape[node + ShapeFieldOffset.lastChild]; }
    private getNextSiblingIndex(node: TreeNodeIndex): TreeNodeIndex { return this.shape[node + ShapeFieldOffset.nextSibling]; }
    private getPrevSiblingIndex(node: TreeNodeIndex): TreeNodeIndex { return this.shape[node + ShapeFieldOffset.prevSibling]; }

    private setParentIndex(node: TreeNodeIndex, parent: TreeNodeIndex)       { this.shape[node + ShapeFieldOffset.parent] = parent; }
    private setFirstChildIndex(parent: TreeNodeIndex, child: TreeNodeIndex)  { this.shape[parent + ShapeFieldOffset.firstChild] = child; }
    private setLastChildIndex(parent: TreeNodeIndex, child: TreeNodeIndex)   { this.shape[parent + ShapeFieldOffset.lastChild] = child; }
    private setPrevSiblingIndex(node: TreeNodeIndex, sibling: TreeNodeIndex) { this.shape[node + ShapeFieldOffset.prevSibling] = sibling; }
    private setNextSiblingIndex(node: TreeNodeIndex, sibling: TreeNodeIndex) { this.shape[node + ShapeFieldOffset.nextSibling] = sibling; }

    private unlink(node: TreeNodeIndex): TreeNodeLocation {
        const oldParent = this.getParentIndex(node);
        const oldNext = this.getNextSiblingIndex(node);
        const oldPrev = this.getPrevSiblingIndex(node);

        if (this.getFirstChildIndex(oldParent) === node) {
            this.setFirstChildIndex(oldParent, oldNext);
        }

        if (this.getLastChildIndex(oldParent) === node) {
            this.setLastChildIndex(oldParent, oldPrev);
        }

        if (oldNext !== TreeNodeIndex.none) {
            this.setPrevSiblingIndex(oldNext, oldPrev);
        }

        if (oldPrev === TreeNodeIndex.none) {
            return this.firstChildOf(toNode(oldParent));
        } else {
            this.setNextSiblingIndex(oldPrev, oldNext);
            return toNode(oldPrev) as unknown as TreeNodeLocation;
        }
    }

    private linkAfter(node: TreeNodeIndex, prev: TreeNodeIndex) {
        const newParent = this.getParentIndex(prev);
        this.setParentIndex(node, newParent);
        if (this.getLastChildIndex(newParent) === prev) {
            this.setLastChildIndex(newParent, node);
        }

        const next = this.getNextSiblingIndex(prev);
        this.setNextSiblingIndex(node, next);
        if (next !== TreeNodeIndex.none) {
            this.setPrevSiblingIndex(next, node);
        }

        this.setPrevSiblingIndex(node, prev);
        this.setNextSiblingIndex(prev, node);
    }

    private linkFirstChild(node: TreeNodeIndex, parent: TreeNodeIndex) {
        this.setParentIndex(node, parent);

        const next = this.getFirstChildIndex(parent);
        if (next === TreeNodeIndex.none) {
            this.setLastChildIndex(parent, node);
        } else {
            this.setPrevSiblingIndex(next, node);
        }

        this.setPrevSiblingIndex(node, TreeNodeIndex.none);
        this.setNextSiblingIndex(node, next);
        this.setFirstChildIndex(parent, node);
    }

    // #region ITreeShapeWriter

    public moveNode(node: TreeNode, location: TreeNodeLocation): void {
        const index = toIndex(node);
        const oldLocation = this.unlink(index);

        if (location > 0) {
            this.linkAfter(index, toIndex(location as unknown as TreeNode));
        } else {
            this.linkFirstChild(index, toIndex(-location as TreeNode));
        }

        FrugalList_forEach(this.consumers, (consumer) => {
            consumer.nodeMoved(node, oldLocation, /* producer: */ this);
        });
    }

    public removeNode(node: TreeNode): void {
        const index = toIndex(node);
        const oldLocation = this.unlink(index);

        this.setParentIndex(index, TreeNodeIndex.none);
        this.setNextSiblingIndex(index, TreeNodeIndex.none);
        this.setPrevSiblingIndex(index, TreeNodeIndex.none);

        FrugalList_forEach(this.consumers, (consumer) => {
            consumer.nodeMoved(node, oldLocation, /* producer: */ this);
        });
    }

    // #endregion
}
