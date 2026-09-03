package com.demo.core.models;

import org.apache.sling.api.resource.Resource;
import org.apache.sling.models.annotations.DefaultInjectionStrategy;
import org.apache.sling.models.annotations.Model;
import org.apache.sling.models.annotations.injectorspecific.ValueMapValue;

@Model(adaptables = Resource.class, defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
public class OgsHeroModel {

    @ValueMapValue
    private String heading;

    @ValueMapValue
    private String body;

    @ValueMapValue
    private String videoPath;

    @ValueMapValue
    private String videoLabel;

    public String getHeading() {
        return heading;
    }

    public String getBody() {
        return body;
    }

    public String getVideoPath() {
        return videoPath;
    }

    public String getVideoLabel() {
        return videoLabel;
    }
}
