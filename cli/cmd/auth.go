package cmd

import (
	"fmt"

	"github.com/spf13/cobra"
	"github.com/vpsql/cli/internal/config"
)

var (
	loginEmail    string
	loginPassword string
	loginEndpoint string
)

var authCmd = &cobra.Command{
	Use:   "auth",
	Short: "Manage authentication and API tokens",
}

var loginCmd = &cobra.Command{
	Use:   "login",
	Short: "Log in to the VPSQL Control Plane node",
	RunE: func(cmd *cobra.Command, args []string) error {
		endpoint := loginEndpoint
		if endpoint == "" {
			endpoint = flagEndpoint
		}
		if endpoint == "" {
			endpoint = cliConfig.Endpoint
		}

		fmt.Printf("Authenticating with %s as %s...\n", endpoint, loginEmail)

		res, err := apiCli.Login(loginEmail, loginPassword)
		if err != nil {
			return fmt.Errorf("authentication failed: %w", err)
		}

		token, _ := res["token"].(string)
		cliConfig.Endpoint = endpoint
		cliConfig.Token = token
		cliConfig.Email = loginEmail

		if err := config.SaveConfig(cliConfig); err != nil {
			return fmt.Errorf("failed to save config: %w", err)
		}

		fmt.Println("✓ Authenticated successfully! Token cached in ~/.vpsql/config.json")
		return nil
	},
}

var statusCmd = &cobra.Command{
	Use:   "status",
	Short: "Show current authentication status",
	RunE: func(cmd *cobra.Command, args []string) error {
		fmt.Printf("Current Endpoint: %s\n", cliConfig.Endpoint)
		if cliConfig.Email != "" {
			fmt.Printf("User:             %s\n", cliConfig.Email)
		}
		if cliConfig.Token != "" {
			fmt.Printf("Token:            [Configured]\n")
		} else {
			fmt.Printf("Token:            [None]\n")
		}

		health, err := apiCli.Health()
		if err != nil {
			fmt.Printf("Node Status:      UNREACHABLE (%v)\n", err)
		} else {
			fmt.Printf("Node Status:      ONLINE (%v)\n", health["postgres"])
		}
		return nil
	},
}

func init() {
	loginCmd.Flags().StringVar(&loginEndpoint, "endpoint", "", "Control plane endpoint (e.g. http://localhost:8080)")
	loginCmd.Flags().StringVar(&loginEmail, "email", "dev@vpsql.io", "User email")
	loginCmd.Flags().StringVar(&loginPassword, "password", "", "User password or API key")

	authCmd.AddCommand(loginCmd)
	authCmd.AddCommand(statusCmd)
	rootCmd.AddCommand(authCmd)
}
