#####################################################################################
# Jekyll plugin that creates and maintains a yaml file (/_data/resolutions.yml)     #
# containing dimentions for each image file stored in /resources/images.            #
#                                                                                   #
# In markdown the dimensions are accessible via site.data.resolutions hash table.   #
# Once /_data/resolutions.yml is generated (locally) and commited, it will be       #
# available on github-pages even though the plugin itseld may be ignored as unsafe. # 
#                                                                                   #
# Authors: Ry Auscitte                                                              #
#                                                                                   #
#####################################################################################

require 'dimensions'
require 'yaml'

module Jekyll
  class JekyllResolutionsListGenerator < Generator
  	safe true
    	priority :high
    	
  	def generate(site)
  		data_name = "resolutions"
      		paths = Dir["#{site.source}/resources/images/*"]
      		needsRefresh = false
      		paths.each do |f|
        		if File.file?(f)
        			filename = f.match(/[^\/]*$/)[0]
        			if not site.data[data_name].key?(filename)
        				needsRefresh = true
        				dims = { "width" => Dimensions.width(f) , "height" => Dimensions.height(f) }
        				site.data[data_name][filename] = dims
        			end	
        		end
        	end
        	
        	if needsRefresh
        		File.open("#{site.source}/_data/#{data_name}.yml","w") do |file|
   				file.write(site.data[data_name].to_yaml)
			end
        	end
      	end
  end  
end  
