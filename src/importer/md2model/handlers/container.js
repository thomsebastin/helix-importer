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

import { getBlockName, getChildElements } from './utils.js';

function getNumberOfRowsWithOneCell(rows) {
  let count = 0;
  for (let i = 0; i < rows.length; i += 1) {
    const cells = getChildElements(rows[i]);
    if (cells.length === 1) {
      count += 1;
    } else {
      break;
    }
  }
  return count;
}

function createModel(node) {
  const modelName = getBlockName(node);
  const rows = getChildElements(node);
  const numberOfRowsWithOneCell = getNumberOfRowsWithOneCell(rows);
  const firstItemCells = getChildElements(rows[numberOfRowsWithOneCell]);
  const fields = firstItemCells.map((cell, idx) => {
    return {
      component: 'richtext',
      name: `text${idx}`,
      value: '',
      label: 'Text',
      valueType: 'string',
    };
  });
  return {
    id: `${modelName}-item`,
    fields,
  };
}

function use(node) {
  // has 1 to n rows
  const rows = getChildElements(node);
  if (rows.length === 0) {
    return false;
  }
  const numberOfRowsWithOneCell = getNumberOfRowsWithOneCell(rows);
  // all rows have more than 2 cells and all the rows have the same amount of cells
  const cellCount = getChildElements(rows[numberOfRowsWithOneCell]).length;
  if (cellCount <= 2) {
    return false;
  }
  for (let i = numberOfRowsWithOneCell; i < rows.length; i += 1) {
    const cells = getChildElements(rows[i]);
    if (cells.length !== cellCount) {
      return false;
    }
  }
  return true;
}

const container = {
  use,
  createModel,
};

export default container;
