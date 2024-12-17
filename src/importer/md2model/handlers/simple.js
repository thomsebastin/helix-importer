/*
 * Copyright 2024 Adobe. All rights reserved.
 * This file is licensed to you under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License. You may obtain a copy
 * of the License at http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under
 * the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
 * OF ANY KIND, either express or implied. See the License for the specific language
 * governing permissions and limitations under the License.
 */

import {
  getBlockName,
  getChildElements,
  getModelDefinition,
} from './utils.js';

function firstChildIsText(node) {
  return node.children.length > 0
    && node.children[0].type === 'text'
    && node.children[0].value.trim().length > 0;
}
function isTitle(node) {
  if (firstChildIsText(node)) {
    return false;
  }
  const elements = getChildElements(node);
  if (elements.length === 1) {
    const { tagName } = elements[0];
    return tagName === 'h1' || tagName === 'h2' || tagName === 'h3'
      || tagName === 'h4' || tagName === 'h5' || tagName === 'h6';
  }
  return false;
}

function isLink(node) {
  if (firstChildIsText(node)) {
    return false;
  }
  const elements = getChildElements(node);
  if (elements.length === 1) {
    const { tagName } = elements[0];
    return tagName === 'a';
  }
  return false;
}

function isImage(node) {
  if (firstChildIsText(node)) {
    return false;
  }
  const elements = getChildElements(node);
  if (elements.length === 1) {
    const { tagName } = elements[0];
    return tagName === 'img';
  }
  return false;
}

function isRichtext(node) {
  const elements = getChildElements(node);
  // if one element is an image, it is not richtext
  if (elements.some((el) => el.tagName === 'img')) {
    return false;
  }
  if (firstChildIsText(node)) {
    return true;
  }
  if (elements.length === 1) {
    const { tagName } = elements[0];
    return tagName === 'pre';
  }
  return false;
}

function isGroup(node) {
  const elements = getChildElements(node);
  return elements.length > 1;
}

function titleFields(idx, prefix = '') {
  return [
    {
      component: 'text',
      label: 'Title',
      name: `${prefix}title${idx}`,
      value: '',
      valueType: 'string',
    },
    {
      component: 'select',
      label: 'Title Type',
      name: `${prefix}title${idx}Type`,
      valueType: 'string',
      options: [
        { name: 'H1', value: 'h1' },
        { name: 'H2', value: 'h2' },
        { name: 'H3', value: 'h3' },
        { name: 'H4', value: 'h4' },
        { name: 'H5', value: 'h5' },
        { name: 'H6', value: 'h6' },
      ],
    },
  ];
}

function linkFields(idx, prefix = '') {
  return [
    {
      component: 'aem-content',
      label: 'Link',
      name: `${prefix}link${idx}`,
      valueType: 'string',
    },
    {
      component: 'select',
      label: 'Link Type',
      name: `${prefix}link${idx}Type`,
      valueType: 'string',
      options: [
        { name: 'Default', value: 'default' },
        { name: 'Primary', value: 'primary' },
        { name: 'Secondary', value: 'secondary' },
      ],
    },
    {
      component: 'text',
      label: 'Link Text',
      name: `${prefix}link${idx}Text`,
      valueType: 'string',
    },
    {
      component: 'text',
      label: 'Link Title',
      name: `${prefix}link${idx}Title`,
      value: '',
      valueType: 'string',
    },
  ];
}

function imageFields(idx, prefix = '') {
  return [
    {
      component: 'reference',
      name: `${prefix}image${idx}`,
      label: 'Image',
      value: '',
      valueType: 'string',
    },
    {
      component: 'text',
      label: 'Alt',
      name: `${prefix}image${idx}Alt`,
      value: '',
      valueType: 'string',
    },
  ];
}

function richtextFields(idx, prefix = '') {
  return [
    {
      component: 'richtext',
      name: `${prefix}text${idx}`,
      value: '',
      label: 'Text',
      valueType: 'string',
    },
  ];
}

function groupFields(idx, node) {
  const cellItems = getChildElements(node);
  let fieldIdx = 0;
  return cellItems.flatMap((cellItem) => {
    const { tagName } = cellItem;
    // if the cell item is a title, create a title field
    if (tagName === 'h1' || tagName === 'h2' || tagName === 'h3'
      || tagName === 'h4' || tagName === 'h5' || tagName === 'h6') {
      fieldIdx += 1;
      return titleFields(fieldIdx, `content${idx}_`);
    }
    // if the cell item is a link, create a link field
    if (tagName === 'a') {
      return linkFields(fieldIdx, `content${idx}_`);
    }
    // if the cell item is an image, create an image field
    if (tagName === 'img') {
      return imageFields(fieldIdx, `content${idx}_`);
    }
    // if the cell item is a paragraph, assess the paragraph children to create the fields
    if (tagName === 'p') {
      const { children } = cellItem;
      const pFields = [];
      for (let i = 0; i < children.length; i += 1) {
        const child = children[i];
        const nextChild = (i < children.length - 1) ? children[i + 1] : null;
        if (child.tagName === 'img') {
          // if the child is an image, create an image field
          fieldIdx += 1;
          pFields.push(...imageFields(fieldIdx, `content${idx}_`));
        } else if (child.type === 'text'
          && child.value.trim().length === 0
          && nextChild && nextChild.tagName === 'a') {
          // if the child is an empty text and the next child is a link, create a link field
          fieldIdx += 1;
          pFields.push(...linkFields(fieldIdx, `content${idx}_`));
          i += 1;
        } else if (child.type === 'text' && child.value.trim().length > 0) {
          // if any subsequent element is an image or an empty text node, create a richtext field
          let hasImage = false;
          let hasEmptyText = false;
          for (let j = i + 1; j < children.length; j += 1) {
            const next = children[j];
            i = j - 1;
            if (next.tagName === 'img') {
              hasImage = true;
              break;
            }
            if (next.type === 'text' && next.value.trim().length === 0) {
              hasEmptyText = true;
              break;
            }
          }
          if (hasImage || hasEmptyText || i === children.length - 1) {
            fieldIdx += 1;
            pFields.push(...richtextFields(fieldIdx, `content${idx}_`));
          }
        }
      }
      return pFields;
    }
    throw new Error(`Unsupported cell type: ${cellItem.tagName}`);
  });
}

function createModel(node) {
  const blockName = getBlockName(node);
  const rows = getChildElements(node);
  const fields = rows.flatMap((row, idx) => {
    const cell = getChildElements(row)[0];
    if (isTitle(cell)) {
      return titleFields(idx);
    }
    if (isLink(cell)) {
      return linkFields(idx);
    }
    if (isImage(cell)) {
      return imageFields(idx);
    }
    if (isRichtext(cell)) {
      return richtextFields(idx);
    }
    if (isGroup(cell)) {
      return groupFields(idx, cell);
    }
    throw new Error(`Unsupported cell type: ${cell.tagName}`);
  });
  return {
    filters: [],
    definitions: [
      getModelDefinition(blockName, blockName),
    ],
    models: [
      {
        id: blockName,
        fields,
      },
    ],
  };
}

function use(node) {
  // has 1 to n rows
  const rows = getChildElements(node);
  if (rows.length === 0) {
    return false;
  }
  // each row has only 1 cell
  if (rows.some((row) => {
    const cells = getChildElements(row);
    return cells.length !== 1;
  })) {
    return false;
  }
  return true;
}

const simple = {
  use,
  createModel,
};

export default simple;
