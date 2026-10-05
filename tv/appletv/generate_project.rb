# Regenerates Streamulus.xcodeproj from the files in Streamulus/.
# Only needed if files are added outside Xcode:
#   gem install xcodeproj && ruby generate_project.rb
require 'xcodeproj'

ROOT = __dir__
PROJECT_PATH = File.join(ROOT, 'Streamulus.xcodeproj')
SOURCE_DIR = 'Streamulus'
DEPLOYMENT_TARGET = '26.0' # Liquid Glass (glassEffect, .glass button styles) needs tvOS 26+

project = Xcodeproj::Project.new(PROJECT_PATH)
project.root_object.attributes['LastUpgradeCheck'] = '2600'
project.root_object.attributes['BuildIndependentTargetsInParallel'] = 'YES'

target = project.new_target(:application, 'Streamulus', :tvos, DEPLOYMENT_TARGET)

# The gem links Foundation.framework by a path inside one specific SDK version,
# which breaks with newer Xcode SDKs; Swift links it automatically anyway.
target.frameworks_build_phase.files.to_a.each do |build_file|
  ref = build_file.file_ref
  build_file.remove_from_project
  ref.remove_from_project if ref
end
project.frameworks_group.remove_from_project if project.frameworks_group.children.empty?
main_group = project.main_group.new_group(SOURCE_DIR, SOURCE_DIR)

# Mirror the folder structure as groups; Swift files compile, the asset catalog is a resource.
def add_dir(project, target, group, dir)
  Dir.children(dir).sort.each do |name|
    path = File.join(dir, name)
    if name.end_with?('.xcassets')
      ref = group.new_file(name)
      target.resources_build_phase.add_file_reference(ref)
    elsif File.directory?(path)
      add_dir(project, target, group.new_group(name, name), path)
    elsif name.end_with?('.swift')
      target.source_build_phase.add_file_reference(group.new_file(name))
    elsif name == 'Info.plist'
      group.new_file(name) # referenced by INFOPLIST_FILE, not copied as a resource
    end
  end
end
add_dir(project, target, main_group, File.join(ROOT, SOURCE_DIR))

target.build_configurations.each do |config|
  s = config.build_settings
  s['PRODUCT_NAME'] = '$(TARGET_NAME)'
  s['PRODUCT_BUNDLE_IDENTIFIER'] = 'com.streamulus.appletv'
  s['MARKETING_VERSION'] = '1.18'
  s['CURRENT_PROJECT_VERSION'] = '19'
  s['SDKROOT'] = 'appletvos'
  s['TARGETED_DEVICE_FAMILY'] = '3'
  s['TVOS_DEPLOYMENT_TARGET'] = DEPLOYMENT_TARGET
  s['SWIFT_VERSION'] = '5.0'
  s['SWIFT_STRICT_CONCURRENCY'] = 'minimal'
  s['SWIFT_EMIT_LOC_STRINGS'] = 'YES'
  s['ENABLE_PREVIEWS'] = 'YES'
  s['CODE_SIGN_STYLE'] = 'Automatic'
  s['DEVELOPMENT_TEAM'] = '' # choose your team in Signing & Capabilities
  s['GENERATE_INFOPLIST_FILE'] = 'YES'
  s['INFOPLIST_FILE'] = "#{SOURCE_DIR}/Info.plist" # adds the http:// (ATS) exception
  s['INFOPLIST_KEY_CFBundleDisplayName'] = 'Streamulus'
  s['INFOPLIST_KEY_UIUserInterfaceStyle'] = 'Dark'
  s['ASSETCATALOG_COMPILER_GLOBAL_ACCENT_COLOR_NAME'] = 'AccentColor'
  # Layered tvOS icon + Top Shelf images in Assets.xcassets (made from the web logo).
  s['ASSETCATALOG_COMPILER_APPICON_NAME'] = 'App Icon & Top Shelf Image'
  s['LD_RUNPATH_SEARCH_PATHS'] = ['$(inherited)', '@executable_path/Frameworks']
end

project.build_configurations.each do |config|
  config.build_settings['TVOS_DEPLOYMENT_TARGET'] = DEPLOYMENT_TARGET
  config.build_settings['SDKROOT'] = 'appletvos'
end

project.save

# Shared scheme so Xcode shows "Streamulus" ready to run.
scheme = Xcodeproj::XCScheme.new
scheme.add_build_target(target)
scheme.set_launch_target(target)
scheme.save_as(PROJECT_PATH, 'Streamulus', true)

puts "Wrote #{PROJECT_PATH}"
