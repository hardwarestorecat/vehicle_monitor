#!/usr/bin/env ts-node
import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse/sync';

interface CSVRow {
  'Plate ID': string;
  'Plate Status': string;
  'Plate Issuer': string;
  'Tags': string;
  'Plate': string;
  [key: string]: string;
}

interface IcePlateEntry {
  plateNumber: string;
  status: 'Confirmed ICE' | 'Highly suspected ICE';
  plateIssuer?: string;
  tags?: string[];
  notes?: string;
}

interface IcePlatesDatabase {
  lastUpdated: string;
  totalPlates: number;
  confirmed: number;
  suspected: number;
  plates: { [plateNumber: string]: IcePlateEntry };
}

async function convertCsvToJson() {
  const csvFilePath = path.join(__dirname, '../Plates-All Plates.csv');
  const outputPath = path.join(__dirname, '../ice-plates.json');

  console.log('Reading CSV file:', csvFilePath);

  // Read CSV file
  const csvContent = fs.readFileSync(csvFilePath, 'utf-8');

  // Parse CSV
  const records: CSVRow[] = parse(csvContent, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    bom: true, // Handle UTF-8 BOM
  });

  console.log(`Parsed ${records.length} records from CSV`);

  const database: IcePlatesDatabase = {
    lastUpdated: new Date().toISOString(),
    totalPlates: 0,
    confirmed: 0,
    suspected: 0,
    plates: {},
  };

  let skipped = 0;

  for (const record of records) {
    const plateNumber = (record['Plate'] || record['Plate ID'] || '').trim().toUpperCase();
    const status = (record['Plate Status'] || '').trim();

    // Skip records without a valid plate number or status
    if (!plateNumber || !status) {
      skipped++;
      continue;
    }

    // Only include "Confirmed ICE" or "Highly suspected ICE"
    if (status !== 'Confirmed ICE' && status !== 'Highly suspected ICE') {
      skipped++;
      continue;
    }

    // Parse tags
    const tagsString = record['Tags'] || '';
    const tags = tagsString
      ? tagsString
          .split(',')
          .map((t) => t.trim())
          .filter((t) => t.length > 0)
      : [];

    // Extract plate issuer (state)
    const plateIssuer = (record['Plate Issuer'] || '').trim();

    // Create entry
    const entry: IcePlateEntry = {
      plateNumber,
      status: status as 'Confirmed ICE' | 'Highly suspected ICE',
    };

    if (plateIssuer) {
      entry.plateIssuer = plateIssuer;
    }

    if (tags.length > 0) {
      entry.tags = tags;
    }

    // Add notes if available
    const notes = record['Plate Record Notes'] || '';
    if (notes.trim()) {
      entry.notes = notes.trim();
    }

    // Add to database
    database.plates[plateNumber] = entry;
    database.totalPlates++;

    if (status === 'Confirmed ICE') {
      database.confirmed++;
    } else {
      database.suspected++;
    }
  }

  console.log('\nConversion complete:');
  console.log(`- Total plates: ${database.totalPlates}`);
  console.log(`- Confirmed ICE: ${database.confirmed}`);
  console.log(`- Highly suspected ICE: ${database.suspected}`);
  console.log(`- Skipped: ${skipped}`);

  // Write JSON file
  fs.writeFileSync(outputPath, JSON.stringify(database, null, 2), 'utf-8');
  console.log(`\nJSON database saved to: ${outputPath}`);
  console.log(`File size: ${(fs.statSync(outputPath).size / 1024).toFixed(2)} KB`);
}

// Run the conversion
convertCsvToJson().catch((error) => {
  console.error('Error converting CSV to JSON:', error);
  process.exit(1);
});
