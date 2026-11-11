package main

import (
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/logger"
	"github.com/gofiber/fiber/v2/middleware/recover"
	"github.com/vpsql/api/internal/config"
	"github.com/vpsql/api/internal/database"
	"github.com/vpsql/api/internal/handlers"
)

func main() {
	cfg := config.Load()

	log.Printf("[VPSQL] Initializing Control Plane on port %d...", cfg.Port)
	log.Printf("[VPSQL] Connecting to PostgreSQL at %s:%d (user: %s)...", cfg.PostgresHost, cfg.PostgresPort, cfg.PostgresUser)

	dbMgr, err := database.NewDBManager(cfg)
	if err != nil {
		log.Fatalf("[FATAL] Failed to initialize database manager: %v", err)
	}
	defer dbMgr.Close()

	app := fiber.New(fiber.Config{
		AppName:      "VPSQL Control Plane v0.4.2",
		ServerHeader: "VPSQL",
	})

	// Middlewares
	app.Use(recover.New())
	app.Use(logger.New(logger.Config{
		Format: "[${time}] ${status} - ${latency} ${method} ${path}\n",
	}))
	app.Use(cors.New(cors.Config{
		AllowOrigins: "*",
		AllowHeaders: "Origin, Content-Type, Accept, Authorization",
		AllowMethods: "GET, POST, PUT, DELETE, OPTIONS",
	}))

	// Register routes
	h := handlers.New(cfg, dbMgr)
	h.RegisterRoutes(app)

	// Graceful shutdown channel
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, os.Interrupt, syscall.SIGTERM)

	go func() {
		<-sigChan
		log.Println("[VPSQL] Shutting down server...")
		_ = app.Shutdown()
	}()

	addr := fmt.Sprintf("0.0.0.0:%d", cfg.Port)
	log.Printf("[VPSQL] Control Plane API listening on http://%s", addr)
	if err := app.Listen(addr); err != nil {
		log.Printf("[VPSQL] Server shut down: %v", err)
	}
}
