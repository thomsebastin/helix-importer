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
/* eslint-disable no-use-before-define */

import { select, selectAll } from 'hast-util-select';
import { toString } from 'hast-util-to-string';
import { toHtml } from 'hast-util-to-html';
import button, { getType } from './button.js';
import { encodeHTMLEntities, getHandler, findFieldsById } from '../utils.js';

function findNameFilterById(componentDefinition, nameClass) {
  let model = null;
  let filterId = null;
  let name = null;
  let keyValue = null;
  componentDefinition.groups.forEach((group) => {
    group.components.forEach((component) => {
      const templateName = component?.plugins?.xwalk?.page?.template?.name;
      if (templateName && templateName.toLowerCase()
        .trim()
        .replace(/[^0-9a-z]+/g, '-')
        .replace(/^-+/, '')
        .replace(/-+$/, '') === nameClass) {
        filterId = component?.plugins?.xwalk?.page?.template?.filter;
        model = component?.plugins?.xwalk?.page?.template?.model;
        keyValue = component?.plugins?.xwalk?.page?.template['key-value'] || false;
        name = templateName;
      }
    });
  });
  return {
    name, filterId, model, keyValue,
  };
}

function encodeHtml(str) {
  /* eslint-disable no-param-reassign */
  str = str.replace(/<code>(.*?)<\/code>/gs, (match) => match.replace(/\n/g, '&#xa;'));
  return str.replace(/&(?!amp;|lt;|gt;|quot;|apos;|#xa|#\d+;|#x[0-9A-Fa-f]+;)/g, '&amp;')
  /**
   * UPS: Replace <br> tags with \n in the HTML string. This was added to
   * fix an issue where the br tags are rendering a "\" in the transformed text.
   * Will revert if this causes any issues elsewhere.
   */
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/</g, '&lt;')
    .replace(/(\r\n|\n|\r)/gm, '')
    .replace(/>[\s]*&lt;/g, '>&lt;');
}

function collapseField(id, fields, node, properties = {}) {
  /* eslint-disable no-param-reassign */
  const suffixes = ['Alt', 'Type', 'MimeType', 'Text', 'Title'];
  suffixes.forEach((suffix) => {
    const field = fields.find((f) => f.name === `${id}${suffix}`);
    if (field) {
      if (suffix === 'Type') {
        if (node?.tagName.startsWith('h')) {
          properties[field.name] = node?.tagName?.toLowerCase();
        } else if (button.use(node)) {
          properties[field.name] = getType(node);
        }
      } else if (button.use(node)) {
        if (suffix === 'Text') {
          properties[field.name] = encodeHTMLEntities(select('a', node)?.children?.[0]?.value);
        } else {
          properties[field.name] = encodeHTMLEntities(select('a', node)?.properties?.[suffix.toLowerCase()]);
        }
      } else if (suffix === 'MimeType') {
        // TODO: can we guess the mime type from the src?
        properties[field.name] = 'image/unknown';
      } else if (suffix === 'Alt') {
        /**
         * UPS: Properties are empty for some unknown reason. This fetches the alt from
         * the image tag and sets it as the alt property.
         * */
        properties[field.name] = encodeHTMLEntities(select('img', node)?.properties?.alt);
      } else {
        properties[field.name] = encodeHTMLEntities(node?.properties?.[suffix.toLowerCase()]);
      }
      // remove falsy names
      if (!properties[field.name]) delete properties[field.name];
      fields.filter((value, index, array) => {
        if (value.name === `${id}${suffix}`) {
          array.splice(index, 1);
          return true;
        }
        return false;
      });
    }
  });
  return properties;
}

function getMainFields(fields) {
  // suffix must be sorted by length descending according to the logic below
  const suffixes = ['MimeType', 'Title', 'Type', 'Text', 'Alt'];
  const itemNames = fields.map((item) => item.name);

  return fields.filter((item) => {
    const itemNameWithoutSuffix = suffixes.reduce((name, suffix) => {
      if (name.endsWith(suffix)) {
        return name.slice(0, -suffix.length);
      }
      return name;
    }, item.name);

    return !(itemNames.includes(itemNameWithoutSuffix) && itemNameWithoutSuffix !== item.name);
  });
}

function createComponentGroups(fields) {
  const components = [];
  fields.forEach((obj) => {
    if (obj.name.includes('_')) {
      const groupName = obj.name.split('_')[0];
      let groupObj = components.find((item) => item.name === groupName);
      if (!groupObj) {
        groupObj = {
          component: 'group',
          name: groupName,
          fields: [],
        };
        components.push(groupObj);
      }
      groupObj.fields.push(obj);
    } else {
      components.push(obj);
    }
  });
  return components;
}

function isHeadlineField(field, fields) {
  if (field.component === 'text') {
    const typeField = fields.find((f) => f.name === `${field.name}Type`);
    const textField = fields.find((f) => f.name === `${field.name}Text`);
    return typeField && !textField; // that would otherwise be a link
  }
  return false;
}

function isLinkField(field, fields) {
  // any text field or a any field that has a Text subfield can be a link
  // TODO: actually any field can be a link but we have to start somewhere
  return field.component === 'text'
    || field.component === 'aem-content'
    || fields.find((f) => f.name === `${field.name}Text`);
}

function isImageField(field, fields) {
  // a reference field is usually an image, cusotm fields may as well but need the MimeType subfield
  return field.component === 'reference' || fields.find((f) => f.name === `${field.name}MimeType`);
}

function extractGroupProperties(node, group, elements, properties, ctx) {
  const groupFields = group.fields;
  const groupMainFields = getMainFields(groupFields);
  let remainingFields = groupMainFields;

  function getSpecificFieldByCondition(value, element, condition) {
    // parse the additional properties for field collapsing and select the first field
    // that matches most properties
    const parsedLinkFields = remainingFields
      .map((field, index) => ({ field, index }))
      .filter(({ field }) => condition(field, groupFields))
      .map(({ field, index }) => ({
        field,
        index,
        properties: {
          [field.name]: value,
          ...collapseField(field.name, [...groupFields], element),
        },
      }));
    const rankedParsedLinkFields = parsedLinkFields.sort((a, b) => {
      const aProps = Object.keys(a.properties).length;
      const bProps = Object.keys(b.properties).length;
      if (aProps === bProps) {
        return a.index - b.index;
      }
      return bProps - aProps;
    });
    const [firstField] = rankedParsedLinkFields;
    return firstField;
  }

  elements.forEach((element) => {
    const handler = getHandler(element, [node], ctx);

    if (handler) {
      if (handler.name === 'button') {
        const href = select('a', element)?.properties?.href;
        const firstField = getSpecificFieldByCondition(href, element, isLinkField);
        /**
         * UPS: tel links in featured list block is handled as a rich text,
         * but the handler treats it as a button and the firstField is not found.
         * Overriding the default behavior to handle tel links as a text and
         * encode the html content.This is done only for list-item block.
         * If needed, will add this for other blocks as well.
         *
         * This is not the proper fix and only works for UPS use case,
         * adding multiple checks to ensure that this doesn't break other blocks.
         */
        if (firstField || href.includes('tel:')) {
          if (!firstField) {
            const hasListDescription = Object.hasOwn(properties, 'listItem_description');
            if (hasListDescription) {
              properties.listItem_description += encodeHtml(toHtml(element).trim());
              return;
            }
          } else {
            properties[firstField.field.name] = encodeHTMLEntities(href);
            collapseField(firstField.field.name, groupFields, element, properties);
            remainingFields = remainingFields.slice(firstField.index + 1);
            return;
          }
        }
      }
      if (handler.name === 'image') {
        const src = select('img', element)?.properties?.src;
        const firstField = getSpecificFieldByCondition(src, element, isImageField);
        if (firstField) {
          properties[firstField.field.name] = encodeHTMLEntities(src);
          collapseField(firstField.field.name, groupFields, element, properties);
          remainingFields = remainingFields.slice(firstField.index + 1);
          return;
        }
      }
      if (handler.name === 'title') {
        const text = toString(element).trim();
        const firstField = getSpecificFieldByCondition(text, element, isHeadlineField);
        if (firstField) {
          properties[firstField.field.name] = encodeHTMLEntities(text);
          collapseField(firstField.field.name, groupFields, element, properties);
          remainingFields = remainingFields.slice(firstField.index + 1);
          return;
        }
      }

      if (handler.name === 'text') {
        // fill in the next field
        // eslint-disable-next-line arrow-body-style
        const nextField = remainingFields.find((field) => {
          // ignore heading and image fields. link field is too generic and cannot be skipped here
          return !isHeadlineField(field, groupFields) && !isImageField(field, groupFields);
        });
        if (nextField) {
          const isNextRichText = nextField.component === 'richtext';
          let text = isNextRichText
            ? encodeHtml(toHtml(element).trim())
            : encodeHTMLEntities(toString(element).trim());

          if (nextField.component === 'multiselect' || nextField.component === 'aem-tag') {
            text = `[${text.split(',').map((v) => v.trim()).join(',')}]`;
          }

          if (properties[nextField.name]) {
            properties[nextField.name] += text;
          } else {
            properties[nextField.name] = text;
          }
          if (!isNextRichText) {
            // update remaining fields only if not richtext.
            // richtext is greedy
            remainingFields = remainingFields.slice(1);
          }
        }
      }
    }
  });
}

function extractProperties(node, id, ctx, mode) {
  const children = node.children.filter((child) => child.type === 'element');
  const properties = {};
  const { componentModels } = ctx;
  const fields = createComponentGroups(findFieldsById(componentModels, id));
  const mainFields = getMainFields(fields);
  let classesFieldHandled = false;
  mainFields.forEach((field, idx) => {
    if (children.length < idx) return;
    const childIdx = classesFieldHandled ? idx - 1 : idx;
    if (field.component === 'group') {
      const selector = mode === 'blockItem' ? ':scope' : 'div > div';
      const containerNode = select(selector, children[childIdx]);
      const containerChildren = containerNode.children.filter((child) => child.type === 'element');
      extractGroupProperties(node, field, containerChildren, properties, ctx);
    } else if (field.name === 'classes' && mode !== 'blockItem') {
      // handle the classes as className only for blocks, not block items
      const classNames = node?.properties?.className;
      if (classNames?.length > 1) {
        let value = classNames.slice(1).map((v) => v.trim()).join(',');
        if (field.component === 'multiselect' || field.component === 'aem-tag') {
          value = `[${value}]`;
        }
        properties[field.name] = value;
      }
      classesFieldHandled = true;
    } else if (field?.component === 'richtext') {
      const parentSelector = mode === 'blockItem' ? ':scope' : ':scope > div';
      const containers = selectAll(parentSelector, children[childIdx]);
      let selection = [];
      containers[0]?.children.forEach((child, index, array) => {
        if (child.type === 'text' && child.value.startsWith('\n')) {
          if (index !== 0 && index !== array.length - 1 && array[index - 1].tagName !== 'p') {
            // replace text element containing \n with a <br> (line break), only if:
            // the element is neither the first nor the last element
            // the element before is not a <p> element
            const lineBreak = {
              type: 'element',
              tagName: 'br',
              properties: {},
              children: [],
            };
            selection.push(lineBreak);
          }
        } else {
          selection.push(child);
        }
      });
      // if the first or the last child is not an element, wrap all the elements in <p></p>
      if (selection[0]?.type !== 'element'
        || selection[selection.length - 1]?.type !== 'element') {
        const p = {
          type: 'element',
          tagName: 'p',
          properties: {},
          children: selection,
        };
        // replace the selection items with the new p
        selection = [p];
      }
      properties[field.name] = encodeHtml(toHtml(selection).trim());
    } else {
      const imageNode = select('img', children[childIdx]);
      const linkNode = select('a', children[childIdx]);
      const headlineNode = select('h1, h2, h3, h4, h5, h6', children[childIdx]);
      if (imageNode && isImageField(field, fields)) {
        properties[field.name] = encodeHTMLEntities(imageNode.properties?.src);
        collapseField(field.name, fields, imageNode, properties);
      } else if (linkNode && isLinkField(field, fields)) {
        properties[field.name] = encodeHTMLEntities(linkNode.properties?.href);
        collapseField(field.name, fields, linkNode, properties);
      } else if (headlineNode) {
        const text = toString(select(headlineNode.tagName, children[childIdx])).trim();
        properties[field.name] = encodeHTMLEntities(text);
        collapseField(field.name, fields, headlineNode, properties);
      } else {
        const selector = mode === 'keyValue' ? 'div > div:nth-last-child(1)' : 'div';
        let value = children[childIdx]
          ? encodeHTMLEntities(toString(select(selector, children[childIdx])).trim())
          : undefined;
        if (field.component === 'multiselect' || field.component === 'aem-tag') {
          value = `[${value
            .split(',')
            .map((v) => v.trim())
            .join(',')}]`;
        }
        if (value) properties[field.name] = value;
      }
    }
  });
  if (mode === 'keyValue') properties['key-value'] = true;
  if (id) properties.model = id;
  return properties;
}

function getBlockItems(node, id, allowedComponents, ctx) {
  if (!allowedComponents.length) {
    return undefined;
  }
  const { pathMap, path, componentDefinition } = ctx;
  const rows = node.children.filter((child) => child.type === 'element' && child.tagName === 'div');
  const { componentModels } = ctx;
  const fields = createComponentGroups(findFieldsById(componentModels, id));
  const fieldsWithoutClasses = fields.filter((field) => field.name !== 'classes');
  // remove the first row if the block has fields as block properties are in the first row
  if (fieldsWithoutClasses.length > 0 && rows.length > 0) {
    rows.shift();
  }
  return rows.map((row, i) => {
    const itemPath = `${path}/item${i + 1}`;
    pathMap.set(rows[i], itemPath);
    const parsedComponents = allowedComponents.map((childComponentId) => {
      const { name, model } = findNameFilterById(componentDefinition, childComponentId);
      const properties = extractProperties(rows[i], model, ctx, 'blockItem');

      /**
       * We have a block called featured list and it has an allowedBlock called list-item.
       * During jcr conversion, this block is sometimes adding empty list items despite
       * not having any such items in the original html. For now, we are fixing this specifically
       * for list-item block by returning null in such cases.
       */
      if (model === 'list-item') {
        const listItemFields = ctx.componentModels.find((item) => item.id === model)
          .fields.map((item) => item.name) || ['listItem_icon', 'listItem_iconMimeType', 'listItem_iconText', 'listItem_description'];
        const hasKey = listItemFields
          .some((field) => Object.prototype.hasOwnProperty.call(properties, field));
        if (!hasKey || (properties.listItem_icon && !properties.listItem_description)) {
          return null;
        }
      }

      return {
        type: 'element',
        name: i > 0 ? `item_${i - 1}` : 'item',
        attributes: {
          'jcr:primaryType': 'nt:unstructured',
          'sling:resourceType': 'core/franklin/components/block/v1/block/item',
          name,
          ...properties,
        },
      };
    });
    return parsedComponents.sort((a, b) => Object.entries(b).length - Object.entries(a).length)[0];
  }).filter((item) => item !== null);
}

function generateProperties(node, ctx) {
  /* eslint-disable no-console */
  const nameClass = node?.properties?.className[0] || undefined;
  if (!nameClass) {
    console.warn('Block component not found');
    return {};
  }
  const { componentModels, componentDefinition, filters } = ctx;
  if (!componentModels || !componentDefinition || !filters) {
    console.warn('Block component not found');
    return {};
  }
  const {
    name, model, filterId, keyValue,
  } = findNameFilterById(componentDefinition, nameClass);
  const allowedComponents = filters.find((item) => item.id === filterId)?.components || [];
  const attributes = extractProperties(node, model, ctx, keyValue ? 'keyValue' : 'simple');
  const blockItems = getBlockItems(node, model, allowedComponents, ctx);
  const properties = {
    name,
    filter: filterId,
    ...attributes,
  };

  return { properties, children: blockItems };
}

function getAttributes(node, ctx) {
  const { properties, children } = generateProperties(node, ctx);
  return {
    rt: 'core/franklin/components/block/v1/block',
    children,
    ...properties,
  };
}

function use(node, parents) {
  return node?.tagName === 'div'
    && parents.length > 2
    && parents[parents.length - 2].tagName === 'main'
    && node.properties?.className?.length > 0
    && node.properties?.className[0] !== 'columns'
    && node.properties?.className[0] !== 'metadata'
    && node.properties?.className[0] !== 'section-metadata';
}

const block = {
  use,
  getAttributes,
  leaf: true,
};

export default block;
