# ============================================================
#  Makefile  –  BeginWithChess (web edition)
#  Usage:
#    make           Build the C++ engine
#    make run       Build engine if needed, then start the server
#    make clean     Remove the engine binary
# ============================================================

CXX      := g++
CXXFLAGS := -std=c++17 -O2 -Wall -Wextra

ENGINE_SRCS := main.cpp \
               engine/board.cpp \
               engine/movegen.cpp \
               engine/evaluation.cpp \
               engine/minimax.cpp

ENGINE_BIN := chess_engine

.PHONY: all engine run clean

all: engine

engine: $(ENGINE_BIN)

$(ENGINE_BIN): $(ENGINE_SRCS)
	$(CXX) $(CXXFLAGS) $^ -o $@
	@chmod +x $@
	@echo "Built ./$(ENGINE_BIN)"

run: engine
	@./run.sh

clean:
	@rm -f $(ENGINE_BIN) $(ENGINE_BIN).exe
	@echo "Cleaned engine binary"
