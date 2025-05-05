import multiprocessing
import os
import argparse
import time

# Import the web server and socket server modules
from web_server import create_app as create_web_app
from socket_server import create_app as create_socket_app

# Configuration do not change here, use options
DEBUG = False

def parse_arguments():
    """Parse command line arguments"""
    parser = argparse.ArgumentParser(description='Start Harmony application')
    parser.add_argument('--port', type=int, default=5000, help='Base port for the web server')
    parser.add_argument('--socket-count', type=int, default=2, help='Number of socket servers to start')
    parser.add_argument('--debug', default=False, action='store_true', help='Enable debug mode (without reverse proxy)')
    return parser.parse_args()

def run_socket_server(port, socket_id):
    """Run a socket server using uvicorn"""
    import uvicorn
    print(f"Starting socket server {socket_id} on port {port}")
    app = create_socket_app(socket_id)
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=port,
        log_level="info" if DEBUG else "error",
    )

def run_web_server(port):
    """Run the Flask web server"""
    app = create_web_app()
    print(f"Starting web server on port {port}")
    app.run(host="0.0.0.0", port=port, debug=DEBUG, use_reloader=False)

def main():
    """Main function to start the application"""
    global DEBUG

    # Parse command line arguments
    args = parse_arguments()

    # Set configuration
    DEBUG = args.debug
    web_port = args.port
    socket_count = args.socket_count

    # Calculate socket ports
    socket_ports = [web_port + i for i in range(1, socket_count + 1)]

    # Set environment variables for socket configuration
    os.environ['WEB_PORT'] = str(web_port)
    os.environ['SOCKET_COUNT'] = str(socket_count)

    # Start socket servers in separate processes
    processes = []
    for i, port in enumerate(socket_ports):
        p = multiprocessing.Process(target=run_socket_server, args=(port, i + 1))
        p.start()
        processes.append((p, port, i + 1))

    # Start web server in the main process
    web_proc = multiprocessing.Process(target=run_web_server, args=(web_port,))
    web_proc.start()

    try:
        while True:
            for i, (proc, port, socket_id) in enumerate(processes):
                if not proc.is_alive():
                    print(
                        f"[Watcher] Socket server {socket_id} on port {port} crashed (exit code {proc.exitcode}). Restarting...")
                    new_proc = multiprocessing.Process(target=run_socket_server, args=(port, socket_id))
                    new_proc.start()
                    processes[i] = (new_proc, port, socket_id)
            time.sleep(5)
    except KeyboardInterrupt:
        print("Shutting down...")
        for proc, _, _ in processes:
            proc.terminate()
        web_proc.terminate()

    for proc, _, _ in processes:
        proc.join()
    web_proc.join()

if __name__ == '__main__':
    main()
