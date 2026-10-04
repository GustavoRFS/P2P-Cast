cmake_minimum_required(VERSION 3.22)
project(p2pcast_process_audio LANGUAGES CXX)

add_executable(p2pcast-process-audio process-audio.cpp)
target_compile_features(p2pcast-process-audio PRIVATE cxx_std_17)
target_compile_definitions(p2pcast-process-audio PRIVATE WIN32_LEAN_AND_MEAN NOMINMAX)
target_link_libraries(p2pcast-process-audio PRIVATE ole32 uuid mmdevapi avrt)

if(MSVC)
  target_compile_options(p2pcast-process-audio PRIVATE /W4 /permissive-)
endif()
