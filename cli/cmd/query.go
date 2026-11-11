package cmd

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"text/tabwriter"

	"github.com/spf13/cobra"
)

var flagQueryJSON bool

var queryCmd = &cobra.Command{
	Use:   "query <database> <sql>",
	Short: "Execute raw SQL query on a database via the control-plane proxy",
	Args:  cobra.ExactArgs(2),
	RunE: func(cmd *cobra.Command, args []string) error {
		dbName := args[0]
		sqlQuery := args[1]

		resp, err := apiCli.ExecuteQuery(dbName, sqlQuery)
		if err != nil {
			return fmt.Errorf("query failed: %w", err)
		}

		if flagQueryJSON {
			data, _ := json.MarshalIndent(resp, "", "  ")
			fmt.Println(string(data))
			return nil
		}

		colsRaw, _ := resp["columns"].([]any)
		rowsRaw, _ := resp["rows"].([]any)
		duration, _ := resp["duration_ms"].(float64)
		rowCount, _ := resp["row_count"].(float64)

		if len(colsRaw) == 0 {
			fmt.Printf("Statement executed in %.2f ms (%d rows affected)\n", duration, int64(rowCount))
			return nil
		}

		cols := make([]string, len(colsRaw))
		for i, c := range colsRaw {
			cols[i] = fmt.Sprint(c)
		}

		w := tabwriter.NewWriter(os.Stdout, 0, 0, 3, ' ', 0)
		fmt.Fprintln(w, strings.Join(cols, "\t"))

		for _, r := range rowsRaw {
			rowMap, ok := r.(map[string]any)
			if !ok {
				continue
			}
			rowVals := make([]string, len(cols))
			for i, col := range cols {
				val := rowMap[col]
				if val == nil {
					rowVals[i] = "NULL"
				} else {
					rowVals[i] = fmt.Sprint(val)
				}
			}
			fmt.Fprintln(w, strings.Join(rowVals, "\t"))
		}
		w.Flush()

		fmt.Printf("\n(%d rows, %.2f ms)\n", len(rowsRaw), duration)
		return nil
	},
}

func init() {
	queryCmd.Flags().BoolVar(&flagQueryJSON, "json", false, "Output as JSON")
	rootCmd.AddCommand(queryCmd)
}
