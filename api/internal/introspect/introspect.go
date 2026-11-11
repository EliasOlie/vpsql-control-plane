package introspect

import (
	"fmt"
	"log"

	"github.com/vpsql/api/internal/database"
	"github.com/vpsql/api/internal/models"
)

type Introspector struct {
	db *database.DBManager
}

func New(db *database.DBManager) *Introspector {
	return &Introspector{db: db}
}

// IntrospectDatabase connects to target database and extracts schema
func (i *Introspector) IntrospectDatabase(dbName string) (*models.SchemaResponse, error) {
	targetDB, err := i.db.ConnectTarget(dbName)
	if err != nil {
		return nil, fmt.Errorf("failed to connect to database %s for introspection: %w", dbName, err)
	}
	defer targetDB.Close()

	// 1. Query table constraints (PK, FK, UNIQUE)
	constraintsQuery := `
	SELECT 
		tc.table_name, 
		kcu.column_name, 
		tc.constraint_type
	FROM information_schema.table_constraints tc
	JOIN information_schema.key_column_usage kcu
	  ON tc.constraint_name = kcu.constraint_name
	  AND tc.table_schema = kcu.table_schema
	WHERE tc.table_schema = 'public'
	  AND tc.constraint_type IN ('PRIMARY KEY', 'FOREIGN KEY', 'UNIQUE');
	`
	flagsMap := make(map[string]map[string]string) // table -> column -> flag
	if cRows, err := targetDB.Query(constraintsQuery); err == nil {
		defer cRows.Close()
		for cRows.Next() {
			var tbl, col, cType string
			if err := cRows.Scan(&tbl, &col, &cType); err == nil {
				if flagsMap[tbl] == nil {
					flagsMap[tbl] = make(map[string]string)
				}
				switch cType {
				case "PRIMARY KEY":
					flagsMap[tbl][col] = "PK"
				case "FOREIGN KEY":
					flagsMap[tbl][col] = "FK"
				case "UNIQUE":
					flagsMap[tbl][col] = "UNIQ"
				}
			}
		}
	} else {
		log.Printf("[WARN] Failed to query constraints: %v", err)
	}

	// 2. Query approximate row counts
	rowsCountQuery := `
	SELECT relname, n_live_tup
	FROM pg_stat_user_tables
	WHERE schemaname = 'public';
	`
	rowCountsMap := make(map[string]int64)
	if rRows, err := targetDB.Query(rowsCountQuery); err == nil {
		defer rRows.Close()
		for rRows.Next() {
			var tbl string
			var count int64
			if err := rRows.Scan(&tbl, &count); err == nil {
				rowCountsMap[tbl] = count
			}
		}
	}

	// 3. Query columns from information_schema.columns (as requested in spec)
	columnsQuery := `
	SELECT 
		table_name, 
		column_name, 
		data_type, 
		is_nullable 
	FROM information_schema.columns 
	WHERE table_schema = 'public' 
	ORDER BY table_name, ordinal_position;
	`
	colsRows, err := targetDB.Query(columnsQuery)
	if err != nil {
		return nil, fmt.Errorf("failed to introspect columns on %s: %w", dbName, err)
	}
	defer colsRows.Close()

	tablesOrder := make([]string, 0)
	tablesMap := make(map[string]*models.TableSchema)

	for colsRows.Next() {
		var tblName, colName, dataType, isNullableStr string
		if err := colsRows.Scan(&tblName, &colName, &dataType, &isNullableStr); err != nil {
			return nil, fmt.Errorf("failed to scan column row: %w", err)
		}

		table, exists := tablesMap[tblName]
		if !exists {
			tablesOrder = append(tablesOrder, tblName)
			approxRows := rowCountsMap[tblName]
			table = &models.TableSchema{
				Name:    tblName,
				Rows:    formatRowCount(approxRows),
				Columns: make([]models.ColumnSchema, 0),
			}
			tablesMap[tblName] = table
		}

		flag := ""
		if tblFlags, ok := flagsMap[tblName]; ok {
			flag = tblFlags[colName]
		}

		color := "#EDEDED"
		if flag == "PK" {
			color = "#4BFF8F"
		} else if flag == "FK" {
			color = "#5B8CFF"
		}

		table.Columns = append(table.Columns, models.ColumnSchema{
			Name:       colName,
			DataType:   dataType,
			IsNullable: isNullableStr == "YES",
			Flag:       flag,
			Color:      color,
		})
	}

	resultTables := make([]models.TableSchema, 0, len(tablesOrder))
	for _, tblName := range tablesOrder {
		resultTables = append(resultTables, *tablesMap[tblName])
	}

	return &models.SchemaResponse{
		Database: dbName,
		Schema:   "public",
		Tables:   resultTables,
	}, nil
}

func formatRowCount(count int64) string {
	if count >= 1_000_000 {
		return fmt.Sprintf("%.1fM", float64(count)/1_000_000)
	}
	if count >= 1_000 {
		return fmt.Sprintf("%.1fk", float64(count)/1_000)
	}
	return fmt.Sprintf("%d", count)
}
